package fabric

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

const (
	SeedVirtualKey     = "sk-fabric-demo"
	SeedProject        = "demo"
	SeedModel          = "gpt-4o-mini"
	SeedAnthropicModel = "claude-haiku-4"
	SeedAdminUser      = "admin"
	SeedAdminPass      = "fabric-admin"
	// CNY per 1_000_000 tokens — independent literals for cost checks.
	SeedInputPriceCNY  = 1.0
	SeedOutputPriceCNY = 2.0
	SeedCachedPriceCNY = 0.1
)

type VirtualKeyRecord struct {
	Hash     string
	Project  string
	Disabled bool
}

type ModelRoute struct {
	Name     string
	Family   string
	Disabled bool
}

type Price struct {
	InputCNY  float64
	OutputCNY float64
	CachedCNY float64
}

type RequestRow struct {
	VirtualKeyHash string
	Project        string
	Model          string
	InputTokens    int
	OutputTokens   int
	CachedTokens   int
	CostCNY        float64
	Status         int
	CreatedAt      time.Time
}

type UsageCell struct {
	Project      string  `json:"project"`
	Model        string  `json:"model"`
	Day          string  `json:"day"`
	InputTokens  int     `json:"input_tokens"`
	OutputTokens int     `json:"output_tokens"`
	CachedTokens int     `json:"cached_tokens"`
	CostCNY      float64 `json:"cost_cny"`
}

type Store interface {
	LookupVirtualKey(ctx context.Context, plaintext string) (VirtualKeyRecord, bool, error)
	LookupModel(ctx context.Context, name string) (ModelRoute, bool, error)
	LookupPrice(ctx context.Context, model string) (Price, bool, error)
	AppendRequest(ctx context.Context, row RequestRow) error
	ListRequests(ctx context.Context, project string) ([]RequestRow, error)
	UsageByProjectModelDay(ctx context.Context, project, day string) ([]UsageCell, error)
	AdminPasswordHash(ctx context.Context, username string) (string, bool, error)
}

func HashVirtualKey(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

// MemoryStore is the in-process ledger used by HTTP tests.
type MemoryStore struct {
	mu        sync.Mutex
	keys      map[string]VirtualKeyRecord
	models    map[string]ModelRoute
	prices    map[string]Price
	requests  []RequestRow
	adminHash string
}

func NewSeededMemoryStore(adminHash string) *MemoryStore {
	return &MemoryStore{
		keys: map[string]VirtualKeyRecord{
			HashVirtualKey(SeedVirtualKey): {Hash: HashVirtualKey(SeedVirtualKey), Project: SeedProject},
		},
		models: map[string]ModelRoute{
			SeedModel:          {Name: SeedModel, Family: "openai", Disabled: false},
			SeedAnthropicModel: {Name: SeedAnthropicModel, Family: "anthropic", Disabled: false},
		},
		prices: map[string]Price{
			SeedModel:          {InputCNY: SeedInputPriceCNY, OutputCNY: SeedOutputPriceCNY, CachedCNY: SeedCachedPriceCNY},
			SeedAnthropicModel: {InputCNY: SeedInputPriceCNY, OutputCNY: SeedOutputPriceCNY, CachedCNY: SeedCachedPriceCNY},
		},
		adminHash: adminHash,
	}
}

func (s *MemoryStore) LookupVirtualKey(_ context.Context, plaintext string) (VirtualKeyRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.keys[HashVirtualKey(plaintext)]
	return rec, ok, nil
}

func (s *MemoryStore) LookupModel(_ context.Context, name string) (ModelRoute, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.models[name]
	return rec, ok, nil
}

func (s *MemoryStore) LookupPrice(_ context.Context, model string) (Price, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.prices[model]
	return rec, ok, nil
}

func (s *MemoryStore) AppendRequest(_ context.Context, row RequestRow) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = append(s.requests, row)
	return nil
}

func (s *MemoryStore) ListRequests(_ context.Context, project string) ([]RequestRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]RequestRow, 0, len(s.requests))
	for _, r := range s.requests {
		if r.Project == project {
			out = append(out, r)
		}
	}
	return out, nil
}

func (s *MemoryStore) UsageByProjectModelDay(_ context.Context, project, day string) ([]UsageCell, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	loc := shanghai()
	agg := map[string]*UsageCell{}
	for _, r := range s.requests {
		if r.Project != project {
			continue
		}
		d := r.CreatedAt.In(loc).Format("2006-01-02")
		if d != day {
			continue
		}
		cell := agg[r.Model]
		if cell == nil {
			cell = &UsageCell{Project: project, Model: r.Model, Day: day}
			agg[r.Model] = cell
		}
		cell.InputTokens += r.InputTokens
		cell.OutputTokens += r.OutputTokens
		cell.CachedTokens += r.CachedTokens
		cell.CostCNY += r.CostCNY
	}
	out := make([]UsageCell, 0, len(agg))
	for _, c := range agg {
		out = append(out, *c)
	}
	return out, nil
}

func (s *MemoryStore) AdminPasswordHash(_ context.Context, username string) (string, bool, error) {
	if username != SeedAdminUser {
		return "", false, nil
	}
	return s.adminHash, s.adminHash != "", nil
}

func shanghai() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}
