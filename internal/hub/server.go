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
	Limits HotLimits
	Clock  Clock

	mu        sync.Mutex
	rr        map[string]uint64
	probeStop chan struct{}
}

func New(st store.Store, client *http.Client) *Server {
	if client == nil {
		client = http.DefaultClient
	}
	clk := Clock(realClock{})
	return &Server{Store: st, Client: client, Limits: NewLimiter(clk), Clock: clk, rr: map[string]uint64{}}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /health/limits", s.handleLimits)
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

func (s *Server) handleLimits(w http.ResponseWriter, _ *http.Request) {
	if s.Limits != nil {
		s.Limits.Tick()
	}
	snap := LimitSnapshot{}
	if s.Limits != nil {
		snap = s.Limits.Snapshot()
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "limits": snap})
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
	if resolved.ExpiresAt != nil && !s.now().Before(*resolved.ExpiresAt) {
		writeUnauthorized(w, protocol)
		return
	}
	if s.Limits != nil {
		s.Limits.Tick()
		s.Limits.RegisterPool(resolved.PoolID, resolved.Channels)
		if !s.Limits.AllowVK(resolved.VirtualKeyID, resolved.RPMLimit, resolved.RPMBurst) {
			writeRateLimited(w, protocol, "vk")
			return
		}
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
		triedIDs    []string
		triedNums   []int64
		lastStatus  int
		lastErr     error
		lastCh      store.Channel
		lastModel   string
		lastCands   []store.Channel
		lastOrder   []store.Channel
		attemptN    int
		skippedOpen int
		skippedProv int
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
			if s.Limits != nil && !s.Limits.AllowChannel(resolved.PoolID, ch.ID) {
				skippedOpen++
				continue
			}
			if s.Limits != nil && !s.Limits.AllowProvider(ch.ProviderCode, ch.ProviderRPM, ch.ProviderBurst) {
				s.Limits.ReleaseChannel(ch.ID)
				skippedProv++
				continue
			}
			if r.Context().Err() != nil {
				if s.Limits != nil {
					s.Limits.ReleaseChannel(ch.ID)
				}
				writeJSON(w, 499, map[string]any{"error": map[string]any{"message": "client cancelled", "code": "cancelled"}})
				return
			}
			attemptN++
			triedIDs = append(triedIDs, fmt.Sprintf("%d", ch.ID))
			triedNums = append(triedNums, ch.ID)
			lastCh = ch
			lastModel = model
			lastCands = cands
			lastOrder = order
			start := s.now()
			resp, ferr := s.fetchUpstream(r, &ch, upstreamPath, upBody)
			lat := s.now().Sub(start)
			if ferr != nil {
				lastErr = ferr
				lastStatus = 0
				if r.Context().Err() != nil {
					if s.Limits != nil {
						s.Limits.ReleaseChannel(ch.ID)
					}
					continue
				}
				if s.Limits != nil {
					s.Limits.Record(resolved.PoolID, ch.ID, lat, false, true)
				}
				continue
			}
			lastStatus = resp.StatusCode
			lastErr = nil
			if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
				_ = s.Store.DisableProviderKey(r.Context(), ch.ID)
			}
			ok := resp.StatusCode >= 200 && resp.StatusCode < 400
			retryable := retryableStatus(resp.StatusCode, nil)
			if s.Limits != nil {
				s.Limits.Record(resolved.PoolID, ch.ID, lat, ok, retryable)
			}
			willRetry := retryable && attemptN < maxAttempts && hasRemaining(models, mi, order, ch.ID)
			if willRetry {
				discardUpstream(resp)
				continue
			}
			modelFB := mi > 0 || (flag.Model != "" && model != flag.Model)
			failover := len(triedIDs) > 1
			fallback := failover || modelFB
			reason := routeReason(cands, order, ch, modelFB, failover)
			setRouteHeaders(w, resolved, ch.ID, reason, triedIDs, model)
			status, _ := writeUpstream(w, resp, flag.Stream)
			s.noteRoute(r, resolved, protocol, flag.Model, model, ch.ID, triedNums, reason, fallback, status)
			return
		}
	}
	if lastErr != nil && lastStatus == 0 && len(triedNums) > 0 {
		modelFB := flag.Model != "" && lastModel != flag.Model
		failover := len(triedNums) > 1
		fallback := failover || modelFB
		reason := routeReason(lastCands, lastOrder, lastCh, modelFB, failover)
		setRouteHeaders(w, resolved, lastCh.ID, reason, triedIDs, lastModel)
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": map[string]any{
				"message": "upstream request failed",
				"type":    "server_error",
				"code":    "provider_error",
			},
		})
		s.noteRoute(r, resolved, protocol, flag.Model, lastModel, lastCh.ID, triedNums, reason, fallback, http.StatusBadGateway)
		return
	}
	if lastStatus != 0 {
		status := lastStatus
		if status < 400 {
			status = http.StatusBadGateway
		}
		reason := "failover"
		if skippedOpen > 0 {
			reason = "circuit_open"
		} else if skippedProv > 0 {
			reason = "provider_limit"
		}
		fallback := len(triedNums) > 1 || (flag.Model != "" && lastModel != flag.Model)
		setRouteHeaders(w, resolved, lastCh.ID, reason, triedIDs, lastModel)
		writeJSON(w, status, map[string]any{
			"error": map[string]any{
				"message": "upstream request failed",
				"type":    "server_error",
				"code":    reason,
			},
		})
		s.noteRoute(r, resolved, protocol, flag.Model, lastModel, lastCh.ID, triedNums, reason, fallback, status)
		return
	}
	if skippedOpen > 0 && attemptN == 0 {
		writeCircuitOpen(w, protocol)
		return
	}
	if skippedProv > 0 && attemptN == 0 {
		writeRateLimited(w, protocol, "provider")
		return
	}
	writeUnavailable(w, protocol)
}

func (s *Server) now() time.Time {
	if s != nil && s.Clock != nil {
		return s.Clock.Now()
	}
	return time.Now()
}

func setRouteHeaders(w http.ResponseWriter, vk *store.ResolvedVK, chID int64, reason string, tried []string, model string) {
	w.Header().Set("X-Fabric-Channel-Id", fmt.Sprintf("%d", chID))
	w.Header().Set("X-Fabric-Route-Reason", reason)
	w.Header().Set("X-Fabric-Tried", strings.Join(tried, ","))
	if model != "" {
		w.Header().Set("X-Fabric-Upstream-Model", model)
	}
	if vk != nil && vk.PoolGroup != "" {
		w.Header().Set("X-Fabric-Pool-Group", vk.PoolGroup)
	}
	if vk != nil && vk.TeamID != 0 {
		w.Header().Set("X-Fabric-Team-Id", fmt.Sprintf("%d", vk.TeamID))
	}
}

func (s *Server) noteRoute(r *http.Request, vk *store.ResolvedVK, protocol, reqModel, upModel string, chID int64, tried []int64, reason string, fallback bool, status int) {
	d := store.RouteDecision{
		VirtualKeyID:   vk.VirtualKeyID,
		Protocol:       protocol,
		RequestedModel: reqModel,
		UpstreamModel:  upModel,
		ChannelID:      chID,
		Tried:          append([]int64(nil), tried...),
		Reason:         reason,
		Fallback:       fallback,
		Status:         status,
		At:             time.Now(),
		TeamID:         vk.TeamID,
		PoolID:         vk.PoolID,
		PoolGroup:      vk.PoolGroup,
	}
	_ = s.Store.RecordRoute(r.Context(), d)
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

func (s *Server) StartProbes() {
	s.mu.Lock()
	if s.probeStop != nil {
		s.mu.Unlock()
		return
	}
	s.probeStop = make(chan struct{})
	stop := s.probeStop
	s.mu.Unlock()
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				s.runDueProbes()
			}
		}
	}()
}

func (s *Server) StopProbes() {
	s.mu.Lock()
	stop := s.probeStop
	s.probeStop = nil
	s.mu.Unlock()
	if stop != nil {
		close(stop)
	}
}

func (s *Server) runDueProbes() {
	if s.Limits == nil {
		return
	}
	s.Limits.Tick()
	for _, ch := range s.Limits.DueProbes() {
		s.ProbeOnce(ch)
	}
}

// ProbeOnce hits a lightweight same-protocol provider endpoint (GET /v1/models).
func (s *Server) ProbeOnce(ch store.Channel) bool {
	if s.Limits != nil && !s.Limits.AllowChannel(ch.PoolID, ch.ID) {
		return false
	}
	ok := s.doLightProbe(ch)
	if s.Limits != nil {
		s.Limits.Record(ch.PoolID, ch.ID, 0, ok, !ok)
	}
	return ok
}

func (s *Server) doLightProbe(ch store.Channel) bool {
	u := strings.TrimRight(ch.BaseURL, "/") + "/v1/models"
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		if s.Limits != nil {
			s.Limits.ReleaseChannel(ch.ID)
		}
		return false
	}
	if ch.Protocol == store.ProtocolAnthropic {
		req.Header.Set("X-Api-Key", ch.Secret)
		req.Header.Set("Anthropic-Version", "2023-06-01")
	} else {
		req.Header.Set("Authorization", "Bearer "+ch.Secret)
	}
	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 400
}

func contains(ss []string, v string) bool {
	for _, s := range ss {
		if s == v {
			return true
		}
	}
	return false
}
