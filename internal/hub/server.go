package hub

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"kodax-fabric/internal/store"
)

type Server struct {
	Store   store.Store
	Client  *http.Client
	Limiter *Limiter
}

func New(st store.Store, client *http.Client) *Server {
	if client == nil {
		client = http.DefaultClient
	}
	return &Server{Store: st, Client: client, Limiter: NewLimiter()}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /v1/chat/completions", s.handleChatCompletions)
	mux.HandleFunc("POST /v1/messages", s.handleMessages)
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

type streamFlag struct {
	Stream bool   `json:"stream"`
	Model  string `json:"model"`
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
	if resolved.ExpiresAt != nil && time.Now().After(*resolved.ExpiresAt) {
		writeUnauthorized(w, protocol)
		return
	}
	if len(resolved.IPWhitelist) > 0 && !ipAllowed(clientIP(r), resolved.IPWhitelist) {
		writeForbidden(w, protocol, "ip not allowed")
		return
	}
	if resolved.RPMLimit > 0 && !s.Limiter.AllowRPM(resolved.VirtualKeyID, resolved.RPMLimit) {
		writeRateLimited(w, protocol)
		return
	}
	if resolved.MonthlyTokenLimit > 0 && resolved.MonthlyTokensUsed >= resolved.MonthlyTokenLimit {
		writeBudgetExceeded(w, protocol)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	_ = r.Body.Close()

	var flag streamFlag
	_ = json.Unmarshal(body, &flag)
	if len(resolved.ModelScope) > 0 && flag.Model != "" && !contains(resolved.ModelScope, flag.Model) {
		writeForbidden(w, protocol, "model not allowed")
		return
	}

	candidates := store.ChannelsForProtocol(resolved.Channels, protocol)
	if len(candidates) == 0 {
		writeUnavailable(w, protocol)
		return
	}

	var last attemptResult
	tried := 0
	for i := range candidates {
		ch := candidates[i]
		if !s.Limiter.ChannelOpen(ch.ID) {
			continue
		}
		tried++
		res := s.proxy(w, r, &ch, upstreamPath, body, flag.Stream)
		last = res
		if res.err != nil && res.status == 0 {
			s.Limiter.RecordFailure(ch.ID)
			continue
		}
		if res.retryable {
			s.Limiter.RecordFailure(ch.ID)
			continue
		}
		if res.status >= 200 && res.status < 400 {
			s.Limiter.RecordSuccess(ch.ID)
			if res.tokens > 0 {
				_ = s.Store.AddUsage(r.Context(), resolved.VirtualKeyID, res.tokens)
			}
			return
		}
		// 4xx: do not failover
		return
	}
	if tried == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": map[string]any{
				"message": "all matching channels are in circuit-open",
				"type":    "server_error",
				"code":    "circuit_open",
			},
		})
		return
	}
	if last.err != nil && last.status == 0 {
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": map[string]any{
				"message": "upstream request failed",
				"type":    "server_error",
				"code":    "provider_error",
			},
		})
	}
}

func clientIP(r *http.Request) string {
	if x := r.Header.Get("X-Forwarded-For"); x != "" {
		return strings.TrimSpace(strings.Split(x, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func ipAllowed(ip string, allow []string) bool {
	for _, a := range allow {
		if a == ip || a == "*" {
			return true
		}
	}
	return false
}

func contains(ss []string, v string) bool {
	for _, s := range ss {
		if s == v {
			return true
		}
	}
	return false
}
