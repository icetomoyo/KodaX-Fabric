package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"kodax-fabric/internal/store"
)

func monthKey(t time.Time) string {
	return t.UTC().Format("2006-01")
}

func budgetUsedThisMonth(vk *store.ResolvedVK, now time.Time) int {
	if vk == nil || vk.BudgetLimit <= 0 {
		return 0
	}
	if vk.BudgetMonth != "" && vk.BudgetMonth != monthKey(now) {
		return 0
	}
	return vk.BudgetUsed
}

func budgetHard(vk *store.ResolvedVK, now time.Time) bool {
	if vk == nil || vk.BudgetLimit <= 0 {
		return false
	}
	return budgetUsedThisMonth(vk, now) >= vk.BudgetLimit
}

func budgetSoft(vk *store.ResolvedVK, now time.Time) bool {
	if vk == nil || vk.BudgetLimit <= 0 {
		return false
	}
	used := budgetUsedThisMonth(vk, now)
	return used*100 >= vk.BudgetLimit*80 && used < vk.BudgetLimit
}

func parseUsageTokens(body []byte) int {
	var wrap struct {
		Usage struct {
			Total      int `json:"total_tokens"`
			Prompt     int `json:"prompt_tokens"`
			Completion int `json:"completion_tokens"`
			Input      int `json:"input_tokens"`
			Output     int `json:"output_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(body, &wrap) != nil {
		return 0
	}
	if wrap.Usage.Total > 0 {
		return wrap.Usage.Total
	}
	if n := wrap.Usage.Prompt + wrap.Usage.Completion; n > 0 {
		return n
	}
	return wrap.Usage.Input + wrap.Usage.Output
}

func extractDeltaChars(payload []byte) int {
	var v map[string]any
	if json.Unmarshal(payload, &v) != nil {
		return 0
	}
	n := 0
	if chs, ok := v["choices"].([]any); ok {
		for _, c := range chs {
			m, _ := c.(map[string]any)
			if m == nil {
				continue
			}
			delta, _ := m["delta"].(map[string]any)
			if delta == nil {
				continue
			}
			if s, ok := delta["content"].(string); ok {
				n += len([]rune(s))
			}
		}
	}
	if d, ok := v["delta"].(map[string]any); ok {
		if s, ok := d["text"].(string); ok {
			n += len([]rune(s))
		}
	}
	return n
}

func (s *Server) creditUsage(vk *store.ResolvedVK, official, estimate int, now time.Time) {
	if s.Store == nil || vk == nil || vk.BudgetLimit <= 0 {
		return
	}
	n := official
	if n <= 0 {
		n = estimate
	}
	if n <= 0 {
		return
	}
	_ = s.Store.AddVKUsage(context.Background(), vk.VirtualKeyID, n, monthKey(now))
}

func stampBudgetWarn(w http.ResponseWriter, vk *store.ResolvedVK, now time.Time) {
	if !budgetSoft(vk, now) {
		return
	}
	w.Header().Set("X-Fabric-Budget-Warn", "true")
	w.Header().Set("X-Fabric-Budget-Used", fmt.Sprintf("%d/%d", budgetUsedThisMonth(vk, now), vk.BudgetLimit))
}
