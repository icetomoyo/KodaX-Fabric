package fabric

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

var errUnknownProject = errors.New("unknown team")
var errUnknownModel = errors.New("unknown model")
var errUnknownEnterprise = errors.New("unknown enterprise")
var errUnknownUser = errors.New("unknown user")
var errDuplicate = errors.New("duplicate")

const (
	RoleSuperAdmin      = "super_admin"
	RoleEnterpriseAdmin = "enterprise_admin"
	RoleTeamAdmin       = "team_admin"
	RoleDeveloper       = "developer"
)

const (
	SeedVirtualKey     = "sk-fabric-demo"
	SeedEnterprise     = "seed"
	SeedTeam           = "demo"
	SeedProject        = SeedTeam
	SeedModel          = "gpt-4o-mini"
	SeedAnthropicModel = "claude-haiku-4"
	SeedAdminUser      = "admin"
	SeedAdminPass      = "fabric-admin"
	// CNY per 1_000_000 tokens — independent literals for cost checks.
	SeedInputPriceCNY  = 1.0
	SeedOutputPriceCNY = 2.0
	SeedCachedPriceCNY = 0.1
)

type Enterprise struct {
	Name     string
	Disabled bool
}

type UserRecord struct {
	Username     string
	Role         string
	Enterprise   string
	Disabled     bool
	PasswordHash string
}

type VirtualKeyRecord struct {
	Hash     string
	Project  string
	Disabled bool
}

type ModelRoute struct {
	Name             string
	Family           string
	Disabled         bool
	Provider         string
	ProviderDisabled bool
}

type Upstream struct {
	Name          string
	Family        string
	BaseURL       string
	Disabled      bool
	KeyCiphertext string
}

type Price struct {
	Model     string  `json:"model"`
	InputCNY  float64 `json:"input_cny"`
	OutputCNY float64 `json:"output_cny"`
	CachedCNY float64 `json:"cached_cny"`
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
	LatencyMS      int64
	RunID          string
	TaskType       string
	CreatedAt      time.Time
}

type UsageCell struct {
	Project        string  `json:"project"`
	Model          string  `json:"model"`
	Day            string  `json:"day"`
	InputTokens    int     `json:"input_tokens"`
	OutputTokens   int     `json:"output_tokens"`
	CachedTokens   int     `json:"cached_tokens"`
	CostCNY        float64 `json:"cost_cny"`
	Calls          int     `json:"calls"`
	FailedCalls    int     `json:"failed_calls"`
	ZeroUsageCalls int     `json:"zero_usage_calls"`
}

type Store interface {
	LookupVirtualKey(ctx context.Context, plaintext string) (VirtualKeyRecord, bool, error)
	LookupModel(ctx context.Context, name string) (ModelRoute, bool, error)
	LookupPrice(ctx context.Context, model string) (Price, bool, error)
	AppendRequest(ctx context.Context, row RequestRow) error
	ListRequests(ctx context.Context, project string) ([]RequestRow, error)
	UsageByProjectModelDay(ctx context.Context, project, day string) ([]UsageCell, error)
	AdminPasswordHash(ctx context.Context, username string) (string, bool, error)
	GetUser(ctx context.Context, username string) (UserRecord, bool, error)
	CreateUser(ctx context.Context, rec UserRecord) error
	AddMember(ctx context.Context, username, team string) error
	RemoveMember(ctx context.Context, username, team string) (bool, error)
	UserTeams(ctx context.Context, username string) ([]string, error)
	ProjectExists(ctx context.Context, name string) (bool, error)
	CreateVirtualKey(ctx context.Context, rec VirtualKeyRecord) error
	GetVirtualKey(ctx context.Context, hash string) (VirtualKeyRecord, bool, error)
	ListVirtualKeys(ctx context.Context) ([]VirtualKeyRecord, error)
	DisableVirtualKey(ctx context.Context, hash string) (bool, error)
	CreateProject(ctx context.Context, name, enterprise string) error
	ListProjects(ctx context.Context) ([]string, error)
	CreateEnterprise(ctx context.Context, name string) error
	ListEnterprises(ctx context.Context) ([]Enterprise, error)
	DisableEnterprise(ctx context.Context, name string) (bool, error)
	TeamEnterprise(ctx context.Context, team string) (Enterprise, bool, error)
	UpsertPrice(ctx context.Context, price Price) error
	DeletePrice(ctx context.Context, model string) (bool, error)
	ListPrices(ctx context.Context) ([]Price, error)
	CreateUpstream(ctx context.Context, u Upstream) error
	GetUpstream(ctx context.Context, name string) (Upstream, bool, error)
	ListUpstreams(ctx context.Context) ([]Upstream, error)
	DisableUpstream(ctx context.Context, name string) (bool, error)
	CreateModel(ctx context.Context, route ModelRoute) error
	DisableModel(ctx context.Context, name string) (bool, error)
	ListModels(ctx context.Context) ([]ModelRoute, error)
}

func HashVirtualKey(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

// MemoryStore is the in-process ledger used by HTTP tests.
type MemoryStore struct {
	mu          sync.Mutex
	keys        map[string]VirtualKeyRecord
	projects    map[string]string
	enterprises map[string]Enterprise
	models      map[string]ModelRoute
	prices      map[string]Price
	upstreams   map[string]Upstream
	requests    []RequestRow
	users       map[string]UserRecord
	memberships map[string]map[string]struct{}
	AppendDelay time.Duration
}

func NewSeededMemoryStore(adminHash string) *MemoryStore {
	return &MemoryStore{
		enterprises: map[string]Enterprise{SeedEnterprise: {Name: SeedEnterprise}},
		projects:    map[string]string{SeedTeam: SeedEnterprise},
		keys: map[string]VirtualKeyRecord{
			HashVirtualKey(SeedVirtualKey): {Hash: HashVirtualKey(SeedVirtualKey), Project: SeedProject},
		},
		models: map[string]ModelRoute{
			SeedModel:          {Name: SeedModel, Family: "openai", Disabled: false},
			SeedAnthropicModel: {Name: SeedAnthropicModel, Family: "anthropic", Disabled: false},
		},
		prices: map[string]Price{
			SeedModel:          {Model: SeedModel, InputCNY: SeedInputPriceCNY, OutputCNY: SeedOutputPriceCNY, CachedCNY: SeedCachedPriceCNY},
			SeedAnthropicModel: {Model: SeedAnthropicModel, InputCNY: SeedInputPriceCNY, OutputCNY: SeedOutputPriceCNY, CachedCNY: SeedCachedPriceCNY},
		},
		upstreams: map[string]Upstream{},
		users: map[string]UserRecord{
			SeedAdminUser: {Username: SeedAdminUser, Role: RoleSuperAdmin, PasswordHash: adminHash},
		},
		memberships: map[string]map[string]struct{}{},
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
	if !ok {
		return ModelRoute{}, false, nil
	}
	if rec.Provider != "" {
		if up, found := s.upstreams[rec.Provider]; found {
			rec.ProviderDisabled = up.Disabled
		}
	}
	return rec, true, nil
}

func (s *MemoryStore) CreateUpstream(_ context.Context, u Upstream) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.upstreams[u.Name]; ok {
		return errDuplicate
	}
	s.upstreams[u.Name] = u
	return nil
}

func (s *MemoryStore) GetUpstream(_ context.Context, name string) (Upstream, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.upstreams[name]
	return u, ok, nil
}

func (s *MemoryStore) ListUpstreams(_ context.Context) ([]Upstream, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Upstream, 0, len(s.upstreams))
	for _, u := range s.upstreams {
		out = append(out, u)
	}
	return out, nil
}

func (s *MemoryStore) DisableUpstream(_ context.Context, name string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.upstreams[name]
	if !ok {
		return false, nil
	}
	u.Disabled = true
	s.upstreams[name] = u
	return true, nil
}

func (s *MemoryStore) CreateModel(_ context.Context, route ModelRoute) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.models[route.Name]; ok {
		return errDuplicate
	}
	s.models[route.Name] = route
	return nil
}

func (s *MemoryStore) DisableModel(_ context.Context, name string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.models[name]
	if !ok {
		return false, nil
	}
	rec.Disabled = true
	s.models[name] = rec
	return true, nil
}

func (s *MemoryStore) ListModels(_ context.Context) ([]ModelRoute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]ModelRoute, 0, len(s.models))
	for _, rec := range s.models {
		out = append(out, rec)
	}
	return out, nil
}

func (s *MemoryStore) UpsertPrice(_ context.Context, price Price) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.models[price.Model]; !ok {
		return errUnknownModel
	}
	s.prices[price.Model] = price
	return nil
}

func (s *MemoryStore) DeletePrice(_ context.Context, model string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.prices[model]; !ok {
		return false, nil
	}
	delete(s.prices, model)
	return true, nil
}

func (s *MemoryStore) ListPrices(_ context.Context) ([]Price, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Price, 0, len(s.prices))
	for model, p := range s.prices {
		p.Model = model
		out = append(out, p)
	}
	return out, nil
}

func (s *MemoryStore) LookupPrice(_ context.Context, model string) (Price, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.prices[model]
	return rec, ok, nil
}

func (s *MemoryStore) AppendRequest(_ context.Context, row RequestRow) error {
	if s.AppendDelay > 0 {
		time.Sleep(s.AppendDelay)
	}
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
		if project != "" && r.Project != project {
			continue
		}
		d := r.CreatedAt.In(loc).Format("2006-01-02")
		if d != day {
			continue
		}
		key := r.Project + "\x00" + r.Model
		cell := agg[key]
		if cell == nil {
			cell = &UsageCell{Project: r.Project, Model: r.Model, Day: day}
			agg[key] = cell
		}
		addUsage(cell, r)
	}
	out := make([]UsageCell, 0, len(agg))
	for _, c := range agg {
		out = append(out, *c)
	}
	return out, nil
}

func addUsage(cell *UsageCell, r RequestRow) {
	cell.Calls++
	cell.InputTokens += r.InputTokens
	cell.OutputTokens += r.OutputTokens
	cell.CachedTokens += r.CachedTokens
	cell.CostCNY += r.CostCNY
	if r.Status >= 400 {
		cell.FailedCalls++
	} else if r.InputTokens == 0 && r.OutputTokens == 0 && r.CachedTokens == 0 {
		cell.ZeroUsageCalls++
	}
}

func (s *MemoryStore) CreateProject(_ context.Context, name, enterprise string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if enterprise == "" {
		enterprise = SeedEnterprise
	}
	if _, ok := s.enterprises[enterprise]; !ok {
		return errUnknownEnterprise
	}
	if _, ok := s.projects[name]; !ok {
		s.projects[name] = enterprise
	}
	return nil
}

func (s *MemoryStore) ListProjects(_ context.Context) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.projects))
	for name := range s.projects {
		out = append(out, name)
	}
	return out, nil
}

func (s *MemoryStore) ProjectExists(_ context.Context, name string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.projects[name]
	return ok, nil
}

func (s *MemoryStore) CreateEnterprise(_ context.Context, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.enterprises[name]; ok {
		return errDuplicate
	}
	s.enterprises[name] = Enterprise{Name: name}
	return nil
}

func (s *MemoryStore) ListEnterprises(_ context.Context) ([]Enterprise, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Enterprise, 0, len(s.enterprises))
	for _, e := range s.enterprises {
		out = append(out, e)
	}
	return out, nil
}

func (s *MemoryStore) DisableEnterprise(_ context.Context, name string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.enterprises[name]
	if !ok {
		return false, nil
	}
	e.Disabled = true
	s.enterprises[name] = e
	return true, nil
}

func (s *MemoryStore) TeamEnterprise(_ context.Context, team string) (Enterprise, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entName, ok := s.projects[team]
	if !ok {
		return Enterprise{}, false, nil
	}
	e, ok := s.enterprises[entName]
	if !ok {
		return Enterprise{Name: entName}, true, nil
	}
	return e, true, nil
}

func (s *MemoryStore) CreateVirtualKey(_ context.Context, rec VirtualKeyRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.projects[rec.Project]; !ok {
		return errUnknownProject
	}
	s.keys[rec.Hash] = rec
	return nil
}

func (s *MemoryStore) GetVirtualKey(_ context.Context, hash string) (VirtualKeyRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.keys[hash]
	return rec, ok, nil
}

func (s *MemoryStore) ListVirtualKeys(_ context.Context) ([]VirtualKeyRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]VirtualKeyRecord, 0, len(s.keys))
	for _, rec := range s.keys {
		out = append(out, rec)
	}
	return out, nil
}

func (s *MemoryStore) DisableVirtualKey(_ context.Context, hash string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.keys[hash]
	if !ok {
		return false, nil
	}
	rec.Disabled = true
	s.keys[hash] = rec
	return true, nil
}

func (s *MemoryStore) AdminPasswordHash(ctx context.Context, username string) (string, bool, error) {
	rec, ok, err := s.GetUser(ctx, username)
	if err != nil || !ok || rec.Disabled {
		return "", false, err
	}
	return rec.PasswordHash, rec.PasswordHash != "", nil
}

func (s *MemoryStore) GetUser(_ context.Context, username string) (UserRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.users[username]
	return rec, ok, nil
}

func (s *MemoryStore) CreateUser(_ context.Context, rec UserRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[rec.Username]; ok {
		return errDuplicate
	}
	if rec.Enterprise != "" {
		if _, ok := s.enterprises[rec.Enterprise]; !ok {
			return errUnknownEnterprise
		}
	}
	s.users[rec.Username] = rec
	return nil
}

func (s *MemoryStore) AddMember(_ context.Context, username, team string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.projects[team]; !ok {
		return errUnknownProject
	}
	if _, ok := s.users[username]; !ok {
		return errUnknownUser
	}
	if s.memberships[username] == nil {
		s.memberships[username] = map[string]struct{}{}
	}
	s.memberships[username][team] = struct{}{}
	return nil
}

func (s *MemoryStore) RemoveMember(_ context.Context, username, team string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teams, ok := s.memberships[username]
	if !ok {
		return false, nil
	}
	if _, ok := teams[team]; !ok {
		return false, nil
	}
	delete(teams, team)
	return true, nil
}

func (s *MemoryStore) UserTeams(_ context.Context, username string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teams := s.memberships[username]
	out := make([]string, 0, len(teams))
	for name := range teams {
		out = append(out, name)
	}
	return out, nil
}

func shanghai() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}
