package hub

import (
	"encoding/json"
	"fmt"
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

	Now func() time.Time

	mu sync.Mutex
	rr map[string]uint64
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

	ch := s.nextChannel(resolved.VirtualKeyID, protocol, resolved.Channels)
	if ch == nil {
		writeUnavailable(w, protocol)
		return
	}

	status, err := s.proxy(w, r, ch, upstreamPath, body, reqMeta.Stream)
	if err != nil {
		if !reqMeta.Stream {
			writeJSON(w, http.StatusBadGateway, map[string]any{
				"error": map[string]any{
					"message": "upstream request failed",
					"type":    "server_error",
					"code":    "provider_error",
				},
			})
		}
		return
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		_ = s.Store.DisableProviderKey(r.Context(), ch.ID)
	}
}

func (s *Server) nextChannel(vkID int64, protocol string, channels []store.Channel) *store.Channel {
	cands := store.ChannelsForProtocol(channels, protocol)
	if len(cands) == 0 {
		return nil
	}
	key := fmt.Sprintf("%d:%s", vkID, protocol)
	s.mu.Lock()
	n := s.rr[key]
	s.rr[key] = n + 1
	s.mu.Unlock()
	c := cands[int(n%uint64(len(cands)))]
	return &c
}
