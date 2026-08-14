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
	CacheTTL          time.Duration

	mu          sync.Mutex
	rr          map[string]uint64
	vkBuckets   map[int64]*tokenBucket
	provBuckets map[string]*tokenBucket
	breakers    map[int64]*breaker
	respCache   map[string]cacheEntry
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
	if !s.vkHasQuota(resolved.VirtualKeyID, resolved.RPMLimit, now) {
		writeRateLimited(w, protocol)
		return
	}
	if budgetHard(resolved, now) {
		writeBudgetExceeded(w, protocol)
		return
	}
	if !ipAllowed(resolved.IPAllow, r) {
		writeForbidden(w, protocol, "ip not allowed")
		return
	}
	stampBudgetWarn(w, resolved, now)

	cacheKey := ""
	if !reqMeta.Stream && requestCacheable(r, body) {
		cacheKey = responseCacheKey(protocol, reqMeta.Model, body)
		if hit, ok := s.cacheGet(cacheKey); ok {
			w.Header().Set("X-Fabric-Cache", "hit")
			writeFetched(w, hit)
			return
		}
		w.Header().Set("X-Fabric-Cache", "miss")
	}
	if !s.allowVK(resolved.VirtualKeyID, resolved.RPMLimit, now) {
		writeRateLimited(w, protocol)
		return
	}

	s.dispatch(w, r, resolved, protocol, upstreamPath, body, reqMeta.Stream, reqMeta.Model, now, cacheKey)
}

func callerIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return xff
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		host = host[:i]
	}
	return strings.Trim(host, "[]")
}

func ipAllowed(allow []string, r *http.Request) bool {
	if len(allow) == 0 {
		return true
	}
	ip := callerIP(r)
	for _, a := range allow {
		if a == ip {
			return true
		}
	}
	return false
}

func (s *Server) dispatch(w http.ResponseWriter, r *http.Request, resolved *store.ResolvedVK, protocol, upstreamPath string, body []byte, stream bool, model string, now time.Time, cacheKey string) {
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
				status, official, estimate, err := s.proxyStream(w, r, ch, upstreamPath, outBody)
				if err != nil && attempt < 2 && s.pickChannel(resolved, protocol, m, used, now) != nil {
					lastErr = err
					s.observeChannel(ch.ID, false, now)
					continue
				}
				if err != nil {
					s.observeChannel(ch.ID, false, now)
					return
				}
				if status == http.StatusUnauthorized || status == http.StatusForbidden {
					_ = s.Store.DisableProviderKey(r.Context(), ch.ID)
				}
				if status >= 200 && status < 400 {
					s.creditUsage(resolved, official, estimate, now)
					s.observeChannel(ch.ID, true, now)
				} else if status >= 500 {
					s.observeChannel(ch.ID, false, now)
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
			if res.status >= 200 && res.status < 400 {
				s.creditUsage(resolved, parseUsageTokens(res.body), 0, now)
				s.cachePut(cacheKey, res)
			}
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
