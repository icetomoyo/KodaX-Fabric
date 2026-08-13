package hub

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"regexp"
	"strconv"

	"kodax-fabric/internal/store"
)

var modelJSON = regexp.MustCompile(`"model"\s*:\s*"[^"]*"`)

func newRequestID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func rewriteJSONModel(body []byte, model string) []byte {
	return modelJSON.ReplaceAll(body, []byte(`"model":"`+model+`"`))
}

func (s *Server) aliasOf(protocol, model string) string {
	if s.Aliases == nil || model == "" {
		return ""
	}
	return s.Aliases[protocol+"|"+model]
}

func (s *Server) stampRoute(w http.ResponseWriter, rid string, ch *store.Channel, hops int, modelFB bool) {
	reason := "priority"
	fb := hops > 1 || modelFB
	if modelFB {
		reason = "model_fallback"
	} else if hops > 1 {
		reason = "failover"
	} else if ch != nil && store.EffectiveWeight(ch.Weight) > 1 {
		reason = "weighted"
	}
	dec := store.RouteDecision{RequestID: rid, Reason: reason, Fallback: fb}
	if ch != nil {
		dec.ChannelID = ch.ID
	}
	w.Header().Set("X-Fabric-Request-Id", rid)
	w.Header().Set("X-Fabric-Route", fmt.Sprintf("channel=%d;reason=%s", dec.ChannelID, reason))
	w.Header().Set("X-Fabric-Fallback", strconv.FormatBool(fb))
	if s.Audit != nil {
		_ = s.Audit(dec)
	} else if s.Store != nil {
		_ = s.Store.SaveRouteDecision(context.Background(), dec)
	}
}

func retryable(status int, err error) bool {
	if err != nil {
		return true
	}
	return status == 429 || status >= 500
}

func (s *Server) pickChannel(vkID int64, protocol, model string, all []store.Channel, used map[int64]bool) *store.Channel {
	best := int(^uint(0) >> 1)
	var pool []store.Channel
	for _, c := range store.ChannelsForProtocol(all, protocol) {
		if used[c.ID] {
			continue
		}
		if !store.ChannelServes(c, model) {
			continue
		}
		r := store.PriorityRank(c.Priority)
		if r < best {
			best = r
			pool = []store.Channel{c}
		} else if r == best {
			pool = append(pool, c)
		}
	}
	if len(pool) == 0 {
		return nil
	}
	return s.weightedPick(vkID, protocol, model, pool, len(used) == 0)
}

func (s *Server) weightedPick(vkID int64, protocol, model string, pool []store.Channel, advance bool) *store.Channel {
	if !advance {
		c := pool[0]
		return &c
	}
	total := 0
	for _, c := range pool {
		total += store.EffectiveWeight(c.Weight)
	}
	if total <= 0 {
		c := pool[0]
		return &c
	}
	key := fmt.Sprintf("%d:%s:%s", vkID, protocol, model)
	s.mu.Lock()
	n := s.rr[key]
	s.rr[key] = n + 1
	s.mu.Unlock()
	slot := int(n % uint64(total))
	acc := 0
	for i := range pool {
		acc += store.EffectiveWeight(pool[i].Weight)
		if slot < acc {
			c := pool[i]
			return &c
		}
	}
	c := pool[len(pool)-1]
	return &c
}
