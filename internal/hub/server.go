package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"kodax-fabric/internal/store"
)

type Server struct {
	Store      store.Store
	Client     *http.Client
	Limits     HotLimits
	Budget     HotBudget
	Cache      ResponseCache
	AdminToken string
	Clock      Clock

	mu        sync.Mutex
	rr        map[string]uint64
	probeStop chan struct{}
}

func New(st store.Store, client *http.Client) *Server {
	if client == nil {
		client = http.DefaultClient
	}
	clk := Clock(realClock{})
	return &Server{
		Store: st, Client: client,
		Limits: NewLimiter(clk), Budget: NewMemoryBudget(clk),
		Cache: NewMemoryCache(clk, time.Hour),
		Clock: clk, rr: map[string]uint64{},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /health/limits", s.handleLimits)
	mux.HandleFunc("GET /health/budget", s.handleBudget)
	mux.HandleFunc("GET /health/cache", s.handleCacheHealth)
	mux.HandleFunc("POST /v1/chat/completions", s.handleChatCompletions)
	mux.HandleFunc("POST /v1/messages", s.handleMessages)
	mux.HandleFunc("POST /admin/v1/vk-applications", s.handleCreateVKApp)
	mux.HandleFunc("GET /admin/v1/vk-applications", s.handleListVKApps)
	mux.HandleFunc("GET /admin/v1/vk-applications/{id}", s.handleGetVKApp)
	mux.HandleFunc("POST /admin/v1/vk-applications/{id}/approve", s.handleApproveVKApp)
	mux.HandleFunc("POST /admin/v1/vk-applications/{id}/reject", s.handleRejectVKApp)
	mux.HandleFunc("GET /admin/v1/provider-keys", s.handleListProviderKeys)
	mux.HandleFunc("POST /admin/v1/provider-keys/{id}/rotate", s.handleRotateProviderKey)
	mux.HandleFunc("POST /admin/v1/provider-keys/{id}/rotate/activate", s.handleActivateProviderKey)
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

func (s *Server) handleBudget(w http.ResponseWriter, _ *http.Request) {
	month := BudgetMonth(s.now())
	var entries []BudgetSnap
	if s.Budget != nil {
		entries = s.Budget.All()
	}
	if entries == nil {
		entries = []BudgetSnap{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "month": month, "budgets": entries})
}

func (s *Server) handleCacheHealth(w http.ResponseWriter, _ *http.Request) {
	var st CacheStats
	if s.Cache != nil {
		st = s.Cache.Stats()
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "cache": st})
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
	if ok, _ := ipAllowed(remoteIP(r), resolved.IPAllow); !ok {
		writeIPForbidden(w, protocol)
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

	resolved.Channels = ExpandRotated(resolved.Channels, s.now())

	cacheStatus := "BYPASS"
	ckey := ""
	if flag.Stream || !wantsResponseCache(r.Header, body) {
		w.Header().Set("X-Fabric-Cache", "BYPASS")
	} else if s.Cache != nil {
		if mc, ok := s.Cache.(*MemoryCache); ok {
			mc.noteCandidate()
		}
		ckey = cacheKey(protocol, resolved, flag.Model, body)
		if ent, ok := s.Cache.Get(ckey); ok {
			if mc, ok := s.Cache.(*MemoryCache); ok {
				mc.noteHit(ent.Tokens)
			}
			w.Header().Set("X-Fabric-Cache", "HIT")
			for k, vs := range ent.Header {
				for _, v := range vs {
					w.Header().Add(k, v)
				}
			}
			w.WriteHeader(ent.Status)
			_, _ = w.Write(ent.Body)
			s.noteRoute(resolved, protocol, flag.Model, flag.Model, 0, nil, "cache_hit", false, ent.Status, BudgetMonth(s.now()), 0, false, "HIT", ent.Tokens)
			return
		}
		cacheStatus = "MISS"
		w.Header().Set("X-Fabric-Cache", "MISS")
		if mc, ok := s.Cache.(*MemoryCache); ok {
			mc.noteMiss()
		}
	} else {
		w.Header().Set("X-Fabric-Cache", "BYPASS")
	}

	if s.Limits != nil {
		s.Limits.Tick()
		s.Limits.RegisterPool(resolved.PoolID, resolved.Channels)
		if !s.Limits.AllowVK(resolved.VirtualKeyID, resolved.RPMLimit, resolved.RPMBurst) {
			writeRateLimited(w, protocol, "vk")
			return
		}
	}

	month := BudgetMonth(s.now())
	hard := resolved.MonthlyHard
	soft := softLimit(hard, resolved.MonthlySoft)
	sess := budgetSession{vkID: resolved.VirtualKeyID, month: month}
	if s.Budget != nil {
		sess.spec = reserveSpecFromBody(body)
		lease, ok := s.Budget.Reserve(resolved.VirtualKeyID, month, hard, sess.spec)
		if hard > 0 && !ok {
			setBudgetHeaders(w, s.Budget.Snap(resolved.VirtualKeyID, month), soft)
			writeBudgetExceeded(w, protocol)
			return
		}
		if ok && lease.ID != 0 {
			sess.lease = lease
			sess.reserved = true
		}
	}
	defer s.finishBudget(&sess)

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
			s.markBudgetHit(&sess)
			resp, ferr, _ := s.fetchWithAuthFallback(r, &ch, upstreamPath, upBody)
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
			if flag.Stream {
				declareBudgetTrailers(w)
			}
			status, werr := writeUpstream(w, resp, flag.Stream, func() {
				if !flag.Stream {
					snap := s.settleBudget(&sess)
					setBudgetHeaders(w, snap, soft)
					return
				}
				if s.Budget != nil {
					setBudgetHeaders(w, s.Budget.Snap(resolved.VirtualKeyID, month), soft)
				}
			}, func(p []byte) {
				if flag.Stream {
					if n := sess.meter.Feed(p); n > 0 {
						s.observeBudget(&sess, n)
					}
					return
				}
				s.ingestNonStream(&sess, p)
			})
			if flag.Stream {
				if n := sess.meter.Flush(); n > 0 {
					s.observeBudget(&sess, n)
				}
				snap := s.settleBudget(&sess)
				setBudgetTrailers(w, snap, soft)
				s.noteRoute(resolved, protocol, flag.Model, model, ch.ID, triedNums, reason, fallback, status, month, soft, sess.over, cacheStatus, extractCachedTokens(sess.meter.official))
				return
			}
			if cacheStatus == "MISS" && werr == nil && status >= 200 && status < 400 && s.Cache != nil && ckey != "" {
				s.rememberResponse(ckey, status, w.Header(), &sess)
			}
			s.noteRoute(resolved, protocol, flag.Model, model, ch.ID, triedNums, reason, fallback, status, month, soft, sess.over, cacheStatus, extractCachedTokens(sess.meter.official))
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
		s.noteRoute(resolved, protocol, flag.Model, lastModel, lastCh.ID, triedNums, reason, fallback, http.StatusBadGateway, month, soft, sess.over, cacheStatus, 0)
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
		s.noteRoute(resolved, protocol, flag.Model, lastModel, lastCh.ID, triedNums, reason, fallback, status, month, soft, sess.over, cacheStatus, 0)
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

func setBudgetHeaders(w http.ResponseWriter, snap BudgetSnap, soft int64) {
	if snap.Month != "" {
		w.Header().Set("X-Fabric-Budget-Month", snap.Month)
	}
	w.Header().Set("X-Fabric-Budget-Used", strconv.FormatInt(snap.Used, 10))
	if soft > 0 && snap.Used >= soft {
		w.Header().Set("X-Fabric-Budget-Soft", "1")
	}
}

func declareBudgetTrailers(w http.ResponseWriter) {
	w.Header().Add("Trailer", "X-Fabric-Budget-Used")
	w.Header().Add("Trailer", "X-Fabric-Budget-Soft")
}

func setBudgetTrailers(w http.ResponseWriter, snap BudgetSnap, soft int64) {
	w.Header().Set("X-Fabric-Budget-Used", strconv.FormatInt(snap.Used, 10))
	if soft > 0 && snap.Used >= soft {
		w.Header().Set("X-Fabric-Budget-Soft", "1")
	}
}

type budgetSession struct {
	vkID       int64
	month      string
	lease      BudgetLease
	spec       ReserveSpec
	meter      sseMeter
	reserved   bool
	hit        bool
	closed     bool
	over       bool
	cachedBody []byte
}

func (s *Server) markBudgetHit(sess *budgetSession) {
	if sess == nil || sess.hit {
		return
	}
	sess.hit = true
	if sess.spec.Input > 0 {
		s.observeBudget(sess, sess.spec.Input)
		sess.meter.est += sess.spec.Input
	}
}

func (s *Server) observeBudget(sess *budgetSession, n int64) {
	if s.Budget == nil || sess == nil || !sess.reserved || n == 0 {
		return
	}
	s.Budget.Observe(sess.lease, n)
}

func (s *Server) ingestNonStream(sess *budgetSession, body []byte) {
	if sess == nil || len(body) == 0 {
		return
	}
	sess.cachedBody = append([]byte(nil), body...)
	mergeUsage(&sess.meter.official, extractUsage(body))
	if sess.meter.official.tokens() == 0 {
		if n := textFieldTokens(body); n > 0 {
			s.observeBudget(sess, n)
			sess.meter.est += n
		}
	}
}

func (s *Server) settleBudget(sess *budgetSession) BudgetSnap {
	if sess == nil {
		return BudgetSnap{}
	}
	if s.Budget == nil || !sess.reserved || sess.closed {
		if s.Budget != nil {
			return s.Budget.Snap(sess.vkID, sess.month)
		}
		return BudgetSnap{VirtualKeyID: sess.vkID, Month: sess.month}
	}
	sess.closed = true
	n := sess.meter.est
	if off := sess.meter.official.tokens(); off > 0 {
		n = off
	}
	if n > sess.lease.Reserved && sess.lease.Reserved > 0 {
		sess.over = true
	}
	return s.Budget.Settle(sess.lease, n)
}

func (s *Server) finishBudget(sess *budgetSession) {
	if sess == nil || !sess.reserved || sess.closed || s.Budget == nil {
		return
	}
	if !sess.hit {
		sess.closed = true
		s.Budget.Release(sess.lease)
		return
	}
	s.settleBudget(sess)
}

func (s *Server) rememberResponse(key string, status int, hdr http.Header, sess *budgetSession) {
	if s.Cache == nil || key == "" {
		return
	}
	// Body already written to client; store a marker-less copy of safe headers only.
	// The actual body is captured in writeUpstream for non-stream via lastNonStream.
	if sess == nil || len(sess.cachedBody) == 0 {
		return
	}
	tok := sess.meter.official.tokens()
	if tok == 0 {
		tok = sess.meter.est
	}
	s.Cache.Set(key, CacheEntry{
		Status: status,
		Header: safeCacheHeaders(hdr),
		Body:   append([]byte(nil), sess.cachedBody...),
		Tokens: tok,
	})
	if mc, ok := s.Cache.(*MemoryCache); ok {
		mc.noteWrite(tok)
	}
}

func (s *Server) noteRoute(vk *store.ResolvedVK, protocol, reqModel, upModel string, chID int64, tried []int64, reason string, fallback bool, status int, month string, soft int64, over bool, cacheStatus string, cachedTok int64) {
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
		BudgetMonth:    month,
		BudgetOver:     over,
		CacheStatus:    cacheStatus,
		CachedTokens:   cachedTok,
	}
	if s.Budget != nil {
		snap := s.Budget.Snap(vk.VirtualKeyID, month)
		d.BudgetUsed = snap.Used
		d.BudgetSoft = soft > 0 && snap.Used >= soft
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.Store.RecordRoute(ctx, d)
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
