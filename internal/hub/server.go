package hub

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"kodax-fabric/internal/store"
)

type Server struct {
	Store    store.Store
	Console  store.Console
	Sessions *Sessions
	UI       http.Handler
	Client   *http.Client

	Now     func() time.Time
	Aliases map[string]string
	Audit   func(store.RouteDecision) error

	BreakerWindow     int
	BreakerMinFail    int
	BreakerOpenRate   float64
	BreakerCoolDown   time.Duration
	BreakerHalfProbes int

	mu          sync.Mutex
	rr          map[string]uint64
	vkBuckets   map[int64]*tokenBucket
	provBuckets map[string]*tokenBucket
	breakers    map[int64]*breaker
}

func New(st store.Store, client *http.Client) *Server {
	if client == nil {
		client = http.DefaultClient
	}
	return &Server{Store: st, Client: client, rr: map[string]uint64{}}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /v1/chat/completions", s.handleChatCompletions)
	mux.HandleFunc("POST /v1/messages", s.handleMessages)
	s.mountConsole(mux)
	if s.UI != nil {
		mux.Handle("/", s.UI)
	}
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "kodax-fabric-gateway",
	})
}

func (s *Server) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	s.relay(w, r, store.ProtocolOpenAI, "/v1/chat/completions")
}

func (s *Server) handleMessages(w http.ResponseWriter, r *http.Request) {
	s.relay(w, r, store.ProtocolAnthropic, "/v1/messages")
}

func (s *Server) relay(w http.ResponseWriter, r *http.Request, protocol, upstreamPath string) {
	rawKey := extractCallerKey(r)
	if rawKey == "" || !strings.HasPrefix(rawKey, "fab-") {
		writeUnauthorized(w, protocol)
		return
	}
	resolved, err := s.Store.ResolveVK(r.Context(), rawKey)
	if err != nil {
		writeUnavailable(w, protocol)
		return
	}
	if resolved == nil {
		writeUnauthorized(w, protocol)
		return
	}
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	if resolved.ExpiresAt != nil && !now.Before(*resolved.ExpiresAt) {
		writeUnauthorized(w, protocol)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	_ = r.Body.Close()

	var reqMeta struct {
		Stream bool   `json:"stream"`
		Model  string `json:"model"`
	}
	_ = json.Unmarshal(body, &reqMeta)
	if !store.ModelAllowed(resolved.ModelScope, reqMeta.Model) {
		writeModelNotAllowed(w, protocol)
		return
	}
	if !s.allowVK(resolved.VirtualKeyID, resolved.RPMLimit, now) {
		writeRateLimited(w, protocol)
		return
	}

	s.dispatch(w, r, resolved, protocol, upstreamPath, body, reqMeta.Stream, reqMeta.Model, now)
}

func (s *Server) dispatch(w http.ResponseWriter, r *http.Request, resolved *store.ResolvedVK, protocol, upstreamPath string, body []byte, stream bool, model string, now time.Time) {
	rid := newRequestID()
	models := []string{model}
	if fb := s.aliasOf(protocol, model); fb != "" && fb != model {
		models = append(models, fb)
	}
	var last upResult
	var lastErr error
	var lastCh *store.Channel
	var lastModel string
	var hops int

	for mi, m := range models {
		used := map[int64]bool{}
		outBody := body
		if mi > 0 {
			outBody = rewriteJSONModel(body, m)
		}
		for attempt := 0; attempt < 3; attempt++ {
			ch := s.pickChannel(resolved, protocol, m, used, now)
			if ch == nil {
				break
			}
			used[ch.ID] = true
			lastCh = ch
			lastModel = m
			hops++
			s.takeProvider(resolved, ch.ProviderCode, now)

			if stream {
				s.stampRoute(w, rid, ch, hops, mi > 0, resolved.PoolGroup)
				status, err := s.proxy(w, r, ch, upstreamPath, outBody, true)
				if err != nil && attempt < 2 && s.pickChannel(resolved, protocol, m, used, now) != nil {
					lastErr = err
					continue
				}
				if err != nil {
					return
				}
				if status == http.StatusUnauthorized || status == http.StatusForbidden {
					_ = s.Store.DisableProviderKey(r.Context(), ch.ID)
				}
				return
			}

			res, err := s.fetchUpstream(r, ch, upstreamPath, outBody)
			if err != nil {
				lastErr = err
				s.observeChannel(ch.ID, false, now)
				if attempt < 2 {
					continue
				}
				break
			}
			last = res
			lastErr = nil
			if res.status == http.StatusUnauthorized || res.status == http.StatusForbidden {
				_ = s.Store.DisableProviderKey(r.Context(), ch.ID)
			}
			if res.status >= 500 {
				s.observeChannel(ch.ID, false, now)
			} else if res.status < 400 {
				s.observeChannel(ch.ID, true, now)
			}
			if retryable(res.status, nil) {
				if attempt < 2 && s.pickChannel(resolved, protocol, m, used, now) != nil {
					continue
				}
				break
			}
			s.stampRoute(w, rid, ch, hops, mi > 0, resolved.PoolGroup)
			writeFetched(w, res)
			return
		}
	}

	s.stampRoute(w, rid, lastCh, hops, lastModel != model, resolved.PoolGroup)
	if last.status != 0 {
		writeFetched(w, last)
		return
	}
	if hops == 0 && s.allProvidersExhausted(resolved, protocol, model, now) {
		writeRateLimited(w, protocol)
		return
	}
	if lastErr != nil && !stream {
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": map[string]any{
				"message": "upstream request failed",
				"type":    "server_error",
				"code":    "provider_error",
			},
		})
		return
	}
	writeUnavailable(w, protocol)
}
