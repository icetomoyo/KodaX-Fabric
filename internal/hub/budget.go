package hub

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// HotBudget is the in-process monthly token ledger for 0.0.7.
// 0.1.0 replaces this with Redis (hot) + Postgres (reconcile); the interface stays.
// Units are integer tokens, never float currency. Commerce / model price tables
// are out of scope: official provider usage wins when present.
//
// Exposure invariant (except recorded official overage):
//
//	settled + pending(observed) + reserved(remaining) + newNeed <= hard
//
// Snap: Used=settled+pending, Settled=settled, Reserved=remaining;
// Used+Reserved is current total exposure.
type HotBudget interface {
	Reserve(vkID int64, month string, hard int64, spec ReserveSpec) (BudgetLease, bool)
	Observe(lease BudgetLease, tokens int64)
	Settle(lease BudgetLease, tokens int64) BudgetSnap
	Release(lease BudgetLease)
	Snap(vkID int64, month string) BudgetSnap
	All() []BudgetSnap
}

// ReserveSpec is computed from the request body after it is fully read.
// HasCap: max_tokens / max_completion_tokens was declared.
// Without a cap and hard>0, Reserve takes the entire remaining budget
// (only one unknown-output request may proceed).
type ReserveSpec struct {
	Input     int64
	OutputCap int64
	HasCap    bool
}

type BudgetLease struct {
	ID       int64
	VKID     int64
	Month    string
	Reserved int64
}

type BudgetSnap struct {
	VirtualKeyID int64  `json:"vk_id"`
	Used         int64  `json:"used"`
	Settled      int64  `json:"settled"`
	Reserved     int64  `json:"reserved"`
	Month        string `json:"month"`
}

type acc struct {
	used     int64
	reserved int64
	pending  int64
}

type reservation struct {
	id        int64
	vkID      int64
	month     string
	need      int64
	remaining int64
	observed  int64
	done      bool
}

type MemoryBudget struct {
	mu    sync.Mutex
	by    map[string]*acc
	lease map[int64]*reservation
	seq   int64
	clock Clock
}

func NewMemoryBudget(clock Clock) *MemoryBudget {
	return &MemoryBudget{by: map[string]*acc{}, lease: map[int64]*reservation{}, clock: clock}
}

func BudgetMonth(t time.Time) string {
	return t.UTC().Format("2006-01")
}

func (b *MemoryBudget) key(vkID int64, month string) string {
	return strconv.FormatInt(vkID, 10) + "|" + month
}

func (b *MemoryBudget) get(vkID int64, month string) *acc {
	k := b.key(vkID, month)
	a := b.by[k]
	if a == nil {
		a = &acc{}
		b.by[k] = a
	}
	return a
}

func (b *MemoryBudget) snapLocked(vkID int64, month string) BudgetSnap {
	a := b.get(vkID, month)
	return BudgetSnap{
		VirtualKeyID: vkID,
		Used:         a.used + a.pending,
		Settled:      a.used,
		Reserved:     a.reserved,
		Month:        month,
	}
}

func exposed(a *acc) int64 {
	return a.used + a.pending + a.reserved
}

func reserveNeed(a *acc, hard int64, spec ReserveSpec) (int64, bool) {
	in := spec.Input
	if in < 0 {
		in = 0
	}
	if spec.HasCap {
		cap := spec.OutputCap
		if cap < 0 {
			cap = 0
		}
		need := in + cap
		if need < 1 {
			need = 1
		}
		if hard > 0 && exposed(a)+need > hard {
			return 0, false
		}
		return need, true
	}
	if hard > 0 {
		rem := hard - exposed(a)
		if rem <= 0 || in > rem {
			return 0, false
		}
		return rem, true
	}
	return in, true
}

func (b *MemoryBudget) Reserve(vkID int64, month string, hard int64, spec ReserveSpec) (BudgetLease, bool) {
	if b == nil {
		if hard > 0 {
			return BudgetLease{}, false
		}
		return BudgetLease{}, true
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	a := b.get(vkID, month)
	need, ok := reserveNeed(a, hard, spec)
	if !ok {
		return BudgetLease{}, false
	}
	b.seq++
	id := b.seq
	a.reserved += need
	b.lease[id] = &reservation{id: id, vkID: vkID, month: month, need: need, remaining: need}
	return BudgetLease{ID: id, VKID: vkID, Month: month, Reserved: need}, true
}

func (b *MemoryBudget) Observe(lease BudgetLease, tokens int64) {
	if b == nil || lease.ID == 0 || tokens <= 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	r := b.lease[lease.ID]
	if r == nil || r.done {
		return
	}
	r.observed += tokens
	a := b.get(r.vkID, r.month)
	a.pending += tokens
	take := tokens
	if take > r.remaining {
		take = r.remaining
	}
	r.remaining -= take
	a.reserved -= take
	if a.reserved < 0 {
		a.reserved = 0
	}
}

func (b *MemoryBudget) Settle(lease BudgetLease, tokens int64) BudgetSnap {
	if b == nil || lease.ID == 0 {
		return BudgetSnap{VirtualKeyID: lease.VKID, Month: lease.Month}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	r := b.lease[lease.ID]
	if r == nil || r.done {
		return b.snapLocked(lease.VKID, lease.Month)
	}
	r.done = true
	a := b.get(r.vkID, r.month)
	a.pending -= r.observed
	if a.pending < 0 {
		a.pending = 0
	}
	if tokens < 0 {
		tokens = 0
	}
	a.used += tokens
	a.reserved -= r.remaining
	if a.reserved < 0 {
		a.reserved = 0
	}
	delete(b.lease, r.id)
	return b.snapLocked(r.vkID, r.month)
}

func (b *MemoryBudget) Release(lease BudgetLease) {
	if b == nil || lease.ID == 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	r := b.lease[lease.ID]
	if r == nil || r.done {
		return
	}
	r.done = true
	a := b.get(r.vkID, r.month)
	a.pending -= r.observed
	if a.pending < 0 {
		a.pending = 0
	}
	a.reserved -= r.remaining
	if a.reserved < 0 {
		a.reserved = 0
	}
	delete(b.lease, r.id)
}

func (b *MemoryBudget) Snap(vkID int64, month string) BudgetSnap {
	if b == nil {
		return BudgetSnap{VirtualKeyID: vkID, Month: month}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.snapLocked(vkID, month)
}

func (b *MemoryBudget) All() []BudgetSnap {
	if b == nil {
		return nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]BudgetSnap, 0, len(b.by))
	for k, a := range b.by {
		vkRaw, month, _ := strings.Cut(k, "|")
		id, _ := strconv.ParseInt(vkRaw, 10, 64)
		out = append(out, BudgetSnap{
			VirtualKeyID: id,
			Used:         a.used + a.pending,
			Settled:      a.used,
			Reserved:     a.reserved,
			Month:        month,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].VirtualKeyID != out[j].VirtualKeyID {
			return out[i].VirtualKeyID < out[j].VirtualKeyID
		}
		return out[i].Month < out[j].Month
	})
	return out
}

func softLimit(hard, soft int64) int64 {
	if soft > 0 {
		return soft
	}
	if hard <= 0 {
		return 0
	}
	return hard * 80 / 100
}

func parseOutputCap(body []byte) (int64, bool) {
	var wrap struct {
		MaxTokens           json.RawMessage `json:"max_tokens"`
		MaxCompletionTokens json.RawMessage `json:"max_completion_tokens"`
	}
	if json.Unmarshal(body, &wrap) != nil {
		return 0, false
	}
	if n, ok := parsePosInt(wrap.MaxCompletionTokens); ok {
		return n, true
	}
	return parsePosInt(wrap.MaxTokens)
}

func parsePosInt(raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}
	var n int64
	if json.Unmarshal(raw, &n) != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

func reserveSpecFromBody(body []byte) ReserveSpec {
	spec := ReserveSpec{Input: textFieldTokens(body)}
	if n, ok := parseOutputCap(body); ok {
		spec.OutputCap = n
		spec.HasCap = true
	}
	return spec
}

type usageBits struct {
	Total      int64
	Prompt     int64
	Completion int64
	Input      int64
	Output     int64
}

type usageJSON struct {
	TotalTokens      int64 `json:"total_tokens"`
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	InputTokens      int64 `json:"input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
}

func (u usageJSON) bits() usageBits {
	return usageBits{
		Total:      u.TotalTokens,
		Prompt:     u.PromptTokens,
		Completion: u.CompletionTokens,
		Input:      u.InputTokens,
		Output:     u.OutputTokens,
	}
}

func (u usageBits) empty() bool {
	return u.Total == 0 && u.Prompt == 0 && u.Completion == 0 && u.Input == 0 && u.Output == 0
}

func (u usageBits) tokens() int64 {
	if u.Total > 0 {
		return u.Total
	}
	if u.Prompt+u.Completion > 0 {
		return u.Prompt + u.Completion
	}
	return u.Input + u.Output
}

func mergeUsage(dst *usageBits, src usageBits) {
	if src.Total > 0 {
		dst.Total = src.Total
	}
	if src.Prompt > 0 {
		dst.Prompt = src.Prompt
	}
	if src.Completion > 0 {
		dst.Completion = src.Completion
	}
	if src.Input > 0 {
		dst.Input = src.Input
	}
	if src.Output > 0 {
		dst.Output = src.Output
	}
}

func extractUsage(raw []byte) usageBits {
	var wrap struct {
		Usage   usageJSON `json:"usage"`
		Message struct {
			Usage usageJSON `json:"usage"`
		} `json:"message"`
	}
	if json.Unmarshal(raw, &wrap) != nil {
		return usageBits{}
	}
	u := wrap.Usage.bits()
	if u.empty() {
		u = wrap.Message.Usage.bits()
	}
	return u
}

func parseUsageTokens(raw []byte) int64 {
	return extractUsage(raw).tokens()
}

func parseUsageFromSSE(p []byte) usageBits {
	var acc usageBits
	for _, line := range bytes.Split(p, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		data := bytes.TrimSpace(line[5:])
		if bytes.Equal(data, []byte("[DONE]")) {
			continue
		}
		mergeUsage(&acc, extractUsage(data))
	}
	return acc
}

func estimateSSETokens(p []byte) int64 {
	var total int64
	for _, line := range bytes.Split(p, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		data := bytes.TrimSpace(line[5:])
		if bytes.Equal(data, []byte("[DONE]")) {
			continue
		}
		if n := textFieldTokens(data); n > 0 {
			total += n
			continue
		}
		if len(data) > 2 {
			total++
		}
	}
	return total
}

func textFieldTokens(b []byte) int64 {
	var n int64
	for _, key := range [][]byte{[]byte(`"content":"`), []byte(`"text":"`)} {
		rest := b
		for {
			i := bytes.Index(rest, key)
			if i < 0 {
				break
			}
			rest = rest[i+len(key):]
			j := 0
			for j < len(rest) {
				if rest[j] == '\\' {
					j += 2
					continue
				}
				if rest[j] == '"' {
					break
				}
				j++
			}
			if j > 0 {
				r := utf8.RuneCount(rest[:min(j, len(rest))])
				t := int64((r + 3) / 4)
				if t < 1 {
					t = 1
				}
				n += t
			}
			if j < len(rest) {
				rest = rest[j+1:]
			} else {
				break
			}
		}
	}
	return n
}

type sseMeter struct {
	rest     []byte
	est      int64
	official usageBits
}

func (m *sseMeter) Feed(p []byte) int64 {
	m.rest = append(m.rest, p...)
	cut := bytes.LastIndexByte(m.rest, '\n')
	if cut < 0 {
		return 0
	}
	chunk := m.rest[:cut+1]
	m.rest = append([]byte(nil), m.rest[cut+1:]...)
	return m.consume(chunk)
}

func (m *sseMeter) Flush() int64 {
	if len(m.rest) == 0 {
		return 0
	}
	chunk := m.rest
	m.rest = nil
	return m.consume(chunk)
}

func (m *sseMeter) consume(chunk []byte) int64 {
	n := estimateSSETokens(chunk)
	m.est += n
	mergeUsage(&m.official, parseUsageFromSSE(chunk))
	return n
}
