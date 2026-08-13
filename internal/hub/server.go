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
	Store  store.Store
	Client *http.Client

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
	if resolved.ExpiresAt != nil && !time.Now().Before(*resolved.ExpiresAt) {
		writeUnauthorized(w, protocol)
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
	if len(resolved.ModelScope) > 0 && (flag.Model == "" || !contains(resolved.ModelScope, flag.Model)) {
		writeForbidden(w, protocol, "model not allowed")
		return
	}

	models, err := s.Store.LookupAlias(r.Context(), flag.Model)
	if err != nil {
		writeUnavailable(w, protocol)
		return
	}
	if len(models) == 0 && flag.Model != "" {
		models = []string{flag.Model}
	}
	if len(models) == 0 {
		models = []string{""}
	}

	const maxAttempts = 3
	var (
		triedIDs   []string
		triedNums  []int64
		lastStatus int
		lastErr    error
		lastCh     store.Channel
		lastModel  string
		lastCands  []store.Channel
		lastOrder  []store.Channel
		attemptN   int
	)
	rrKey := fmt.Sprintf("%d:%s:%s", resolved.VirtualKeyID, protocol, flag.Model)
	s.mu.Lock()
	n := s.rr[rrKey]
	s.rr[rrKey] = n + 1
	s.mu.Unlock()

	for mi, model := range models {
		cands := store.ChannelsForModel(resolved.Channels, protocol, model)
		if len(cands) == 0 {
			continue
		}
		order := attemptOrder(cands, n)
		upBody := body
		if flag.Model != "" && model != flag.Model {
			upBody = rewriteModel(body, model)
		}
		for _, ch := range order {
			if attemptN >= maxAttempts {
				break
			}
			attemptN++
			triedIDs = append(triedIDs, fmt.Sprintf("%d", ch.ID))
			triedNums = append(triedNums, ch.ID)
			lastCh = ch
			lastModel = model
			lastCands = cands
			lastOrder = order
			resp, ferr := s.fetchUpstream(r, &ch, upstreamPath, upBody)
			if ferr != nil {
				lastErr = ferr
				lastStatus = 0
				continue
			}
			lastStatus = resp.StatusCode
			lastErr = nil
			if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
				_ = s.Store.DisableProviderKey(r.Context(), ch.ID)
			}
			willRetry := retryableStatus(resp.StatusCode, nil) && attemptN < maxAttempts && hasRemaining(models, mi, order, ch.ID)
			if willRetry {
				discardUpstream(resp)
				continue
			}
			modelFB := mi > 0 || (flag.Model != "" && model != flag.Model)
			failover := len(triedIDs) > 1
			fallback := failover || modelFB
			reason := routeReason(cands, order, ch, modelFB, failover)
			setRouteHeaders(w, ch.ID, reason, triedIDs, model)
			status, _ := writeUpstream(w, resp, flag.Stream)
			s.noteRoute(r, resolved.VirtualKeyID, protocol, flag.Model, model, ch.ID, triedNums, reason, fallback, status)
			return
		}
	}
	if lastErr != nil && lastStatus == 0 && len(triedNums) > 0 {
		modelFB := flag.Model != "" && lastModel != flag.Model
		failover := len(triedNums) > 1
		fallback := failover || modelFB
		reason := routeReason(lastCands, lastOrder, lastCh, modelFB, failover)
		setRouteHeaders(w, lastCh.ID, reason, triedIDs, lastModel)
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": map[string]any{
				"message": "upstream request failed",
				"type":    "server_error",
				"code":    "provider_error",
			},
		})
		s.noteRoute(r, resolved.VirtualKeyID, protocol, flag.Model, lastModel, lastCh.ID, triedNums, reason, fallback, http.StatusBadGateway)
		return
	}
	if lastStatus == 0 {
		writeUnavailable(w, protocol)
	}
}

func setRouteHeaders(w http.ResponseWriter, chID int64, reason string, tried []string, model string) {
	w.Header().Set("X-Fabric-Channel-Id", fmt.Sprintf("%d", chID))
	w.Header().Set("X-Fabric-Route-Reason", reason)
	w.Header().Set("X-Fabric-Tried", strings.Join(tried, ","))
	if model != "" {
		w.Header().Set("X-Fabric-Upstream-Model", model)
	}
}

func (s *Server) noteRoute(r *http.Request, vkID int64, protocol, reqModel, upModel string, chID int64, tried []int64, reason string, fallback bool, status int) {
	_ = s.Store.RecordRoute(r.Context(), store.RouteDecision{
		VirtualKeyID:   vkID,
		Protocol:       protocol,
		RequestedModel: reqModel,
		UpstreamModel:  upModel,
		ChannelID:      chID,
		Tried:          append([]int64(nil), tried...),
		Reason:         reason,
		Fallback:       fallback,
		Status:         status,
		At:             time.Now(),
	})
}

func attemptOrder(cands []store.Channel, n uint64) []store.Channel {
	if len(cands) == 0 {
		return nil
	}
	var groups [][]store.Channel
	for _, c := range cands {
		if len(groups) == 0 || groups[len(groups)-1][0].Rank() != c.Rank() {
			groups = append(groups, []store.Channel{c})
			continue
		}
		groups[len(groups)-1] = append(groups[len(groups)-1], c)
	}
	out := make([]store.Channel, 0, len(cands))
	for _, g := range groups {
		i := store.PickWeighted(g, n)
		out = append(out, g[i])
		for j, c := range g {
			if j != i {
				out = append(out, c)
			}
		}
	}
	return out
}

func hasRemaining(models []string, mi int, order []store.Channel, usedID int64) bool {
	for _, c := range order {
		if c.ID != usedID {
			return true
		}
	}
	return mi+1 < len(models)
}

func routeReason(cands, order []store.Channel, chosen store.Channel, modelFallback bool, failover bool) string {
	if modelFallback {
		return "model_fallback"
	}
	if failover {
		return "failover"
	}
	if len(cands) > 1 && cands[0].Rank() == chosen.Rank() {
		same := 0
		for _, c := range cands {
			if c.Rank() == chosen.Rank() {
				same++
			}
		}
		if same > 1 {
			return "weighted"
		}
	}
	return "priority"
}

func rewriteModel(body []byte, model string) []byte {
	var m map[string]any
	if json.Unmarshal(body, &m) != nil {
		return body
	}
	m["model"] = model
	out, err := json.Marshal(m)
	if err != nil {
		return body
	}
	return out
}

func contains(ss []string, v string) bool {
	for _, s := range ss {
		if s == v {
			return true
		}
	}
	return false
}
