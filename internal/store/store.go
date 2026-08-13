package store

import (
	"context"
	"errors"
	"sort"
	"time"
)

var (
	ErrAlreadyDecided          = errors.New("application already decided")
	ErrKeyNotFound             = errors.New("provider key not found")
	ErrNoReplacement           = errors.New("no replacement staged")
	ErrRotationConflict        = errors.New("rotation already pending")
	ErrInvalidRotationSchedule = errors.New("invalid rotation schedule")
	ErrNotFound                = errors.New("not found")
	ErrConflict                = errors.New("conflict")
	ErrBadRequest              = errors.New("bad request")
)

const (
	ProtocolOpenAI    = "openai_chat"
	ProtocolAnthropic = "anthropic_messages"
)

type Channel struct {
	ID             int64
	Protocol       string
	BaseURL        string
	Secret         string
	Status         string
	Priority       int
	Weight         int
	Models         []string
	PoolID         int64
	TeamID         int64
	KeyTeamID      int64
	ProviderCode   string
	ProviderRPM    int
	ProviderBurst  int
	ProviderKeyID  int64
	Replacement    string
	ActivateAt     *time.Time
	RetireAt       *time.Time
	FallbackSecret string
}

type ResolvedVK struct {
	VirtualKeyID int64
	PoolID       int64
	PoolName     string
	PoolGroup    string
	TeamID       int64
	TeamName     string
	ProjectID    int64
	ProjectName  string
	ExpiresAt    *time.Time
	ModelScope   []string
	RPMLimit     int
	RPMBurst     int
	MonthlyHard  int64
	MonthlySoft  int64
	IPAllow      []string
	Channels     []Channel
}

type RouteDecision struct {
	VirtualKeyID   int64
	Protocol       string
	RequestedModel string
	UpstreamModel  string
	ChannelID      int64
	Tried          []int64
	Reason         string
	Fallback       bool
	Status         int
	At             time.Time
	TeamID         int64
	PoolID         int64
	PoolGroup      string
	BudgetUsed     int64
	BudgetSoft     bool
	BudgetMonth    string
	BudgetOver     bool
	CacheStatus    string
	CachedTokens   int64
}

const (
	AppPending  = "pending"
	AppApproved = "approved"
	AppRejected = "rejected"
)

type VKApplication struct {
	ID           int64      `json:"id"`
	TeamID       int64      `json:"team_id"`
	ProjectID    int64      `json:"project_id"`
	PoolID       int64      `json:"pool_id"`
	Purpose      string     `json:"purpose"`
	MonthlyHard  int64      `json:"monthly_hard"`
	MonthlySoft  int64      `json:"monthly_soft"`
	ModelScope   []string   `json:"model_scope"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	IPAllow      []string   `json:"ip_allow"`
	Status       string     `json:"status"`
	RejectReason string     `json:"reject_reason,omitempty"`
	VirtualKeyID int64      `json:"virtual_key_id,omitempty"`
	KeyPrefix    string     `json:"key_prefix,omitempty"`
	KeyMasked    string     `json:"key_masked,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type ProviderKeyView struct {
	ID             int64      `json:"id"`
	ProviderCode   string     `json:"provider_code"`
	Status         string     `json:"status"`
	TeamID         int64      `json:"team_id"`
	RPMLimit       int        `json:"rpm_limit"`
	RPMBurst       int        `json:"rpm_burst"`
	HasReplacement bool       `json:"has_replacement"`
	ActivateAt     *time.Time `json:"activate_at,omitempty"`
	RetireAt       *time.Time `json:"retire_at,omitempty"`
}

// IsolateChannels drops channels/keys that do not belong to the VK.
// Ownerless VK (TeamID==0) only sees ownerless keys/channels; labeled PoolID must match.
// Team VK requires exact TeamID/KeyTeamID and a non-zero PoolID equal to the VK pool.
func IsolateChannels(vk *ResolvedVK) *ResolvedVK {
	if vk == nil {
		return nil
	}
	out := *vk
	var chs []Channel
	for _, c := range vk.Channels {
		if vk.TeamID == 0 {
			if c.TeamID != 0 || c.KeyTeamID != 0 {
				continue
			}
			if c.PoolID != 0 && c.PoolID != vk.PoolID {
				continue
			}
			chs = append(chs, c)
			continue
		}
		if c.TeamID != vk.TeamID || c.KeyTeamID != vk.TeamID {
			continue
		}
		if c.PoolID == 0 || c.PoolID != vk.PoolID {
			continue
		}
		chs = append(chs, c)
	}
	out.Channels = chs
	return &out
}

type Store interface {
	ResolveVK(ctx context.Context, rawKey string) (*ResolvedVK, error)
	DisableProviderKey(ctx context.Context, channelID int64) error
	LookupAlias(ctx context.Context, model string) ([]string, error)
	RecordRoute(ctx context.Context, d RouteDecision) error
	RecentRoutes(ctx context.Context, vkID int64) ([]RouteDecision, error)
	CreateVKApplication(ctx context.Context, app VKApplication) (*VKApplication, error)
	GetVKApplication(ctx context.Context, id int64) (*VKApplication, error)
	ListVKApplications(ctx context.Context) ([]VKApplication, error)
	ApproveVKApplication(ctx context.Context, id int64, now time.Time) (*VKApplication, string, error)
	RejectVKApplication(ctx context.Context, id int64, reason string) (*VKApplication, error)
	StageProviderRotation(ctx context.Context, keyID int64, secret string, activate, retire *time.Time, now time.Time) error
	ActivateProviderRotation(ctx context.Context, keyID int64, now time.Time) error
	ListProviderKeys(ctx context.Context) ([]ProviderKeyView, error)
	ListProviders(ctx context.Context) ([]ProviderKeyView, error)
	CreateProvider(ctx context.Context, in ProviderWrite) (*ProviderKeyView, error)
	UpdateProvider(ctx context.Context, id int64, in ProviderPatch) (*ProviderKeyView, error)
	DisableProvider(ctx context.Context, id int64) error
	ListPools(ctx context.Context) ([]ChannelPool, error)
	CreatePool(ctx context.Context, in ChannelPool) (*ChannelPool, error)
	UpdatePool(ctx context.Context, id int64, in PoolPatch) (*ChannelPool, error)
	ListChannelsAdmin(ctx context.Context) ([]ChannelAdmin, error)
	CreateChannel(ctx context.Context, in ChannelAdmin) (*ChannelAdmin, error)
	UpdateChannel(ctx context.Context, id int64, in ChannelPatch) (*ChannelAdmin, error)
	DisableChannel(ctx context.Context, id int64) error
	ListVirtualKeys(ctx context.Context) ([]VirtualKeyAdmin, error)
	CreateVirtualKey(ctx context.Context, in VirtualKeyAdmin) (*VirtualKeyAdmin, string, error)
	UpdateVirtualKey(ctx context.Context, id int64, in VirtualKeyPatch) (*VirtualKeyAdmin, error)
	DisableVirtualKey(ctx context.Context, id int64) error
	Ping(ctx context.Context) error
}

type ProviderWrite struct {
	ProviderCode string `json:"provider_code"`
	Secret       string `json:"secret,omitempty"`
	Status       string `json:"status"`
	RPMLimit     int    `json:"rpm_limit"`
	RPMBurst     int    `json:"rpm_burst"`
	TeamID       int64  `json:"team_id"`
}

type ProviderPatch struct {
	ProviderCode *string `json:"provider_code"`
	Secret       *string `json:"secret"`
	Status       *string `json:"status"`
	RPMLimit     *int    `json:"rpm_limit"`
	RPMBurst     *int    `json:"rpm_burst"`
	TeamID       *int64  `json:"team_id"`
}

type ChannelPool struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	GroupName string `json:"group_name"`
	TeamID    int64  `json:"team_id"`
}

type PoolPatch struct {
	Name      *string `json:"name"`
	GroupName *string `json:"group_name"`
	TeamID    *int64  `json:"team_id"`
}

type ChannelAdmin struct {
	ID            int64    `json:"id"`
	PoolID        int64    `json:"pool_id"`
	ProviderKeyID int64    `json:"provider_key_id"`
	Protocol      string   `json:"protocol"`
	BaseURL       string   `json:"base_url"`
	Status        string   `json:"status"`
	Priority      int      `json:"priority"`
	Weight        int      `json:"weight"`
	Models        []string `json:"models"`
}

type ChannelPatch struct {
	PoolID        *int64    `json:"pool_id"`
	ProviderKeyID *int64    `json:"provider_key_id"`
	Protocol      *string   `json:"protocol"`
	BaseURL       *string   `json:"base_url"`
	Status        *string   `json:"status"`
	Priority      *int      `json:"priority"`
	Weight        *int      `json:"weight"`
	Models        *[]string `json:"models"`
}

type VirtualKeyAdmin struct {
	ID          int64      `json:"id"`
	PoolID      int64      `json:"pool_id"`
	ProjectID   int64      `json:"project_id"`
	Status      string     `json:"status"`
	KeyPrefix   string     `json:"key_prefix,omitempty"`
	KeyMasked   string     `json:"key_masked,omitempty"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	ModelScope  []string   `json:"model_scope"`
	IPAllow     []string   `json:"ip_allow"`
	RPMLimit    int        `json:"rpm_limit"`
	RPMBurst    int        `json:"rpm_burst"`
	MonthlyHard int64      `json:"monthly_hard"`
	MonthlySoft int64      `json:"monthly_soft"`
}

type VirtualKeyPatch struct {
	PoolID      *int64     `json:"pool_id"`
	ProjectID   *int64     `json:"project_id"`
	Status      *string    `json:"status"`
	ExpiresAt   *time.Time `json:"expires_at"`
	ModelScope  *[]string  `json:"model_scope"`
	IPAllow     *[]string  `json:"ip_allow"`
	RPMLimit    *int       `json:"rpm_limit"`
	RPMBurst    *int       `json:"rpm_burst"`
	MonthlyHard *int64     `json:"monthly_hard"`
	MonthlySoft *int64     `json:"monthly_soft"`
}

// Rank: smaller priority wins (1 primary, 2 backup). 0/negative = unset, after any explicit 1/2.
func (c Channel) Rank() int {
	if c.Priority <= 0 {
		return 1_000_000
	}
	return c.Priority
}

func (c Channel) WeightOrDefault() int {
	if c.Weight <= 0 {
		return 1
	}
	return c.Weight
}

func (c Channel) ServesModel(model string) bool {
	if model == "" || len(c.Models) == 0 {
		return true
	}
	for _, m := range c.Models {
		if m == model {
			return true
		}
	}
	return false
}

func ChannelsForProtocol(channels []Channel, protocol string) []Channel {
	var out []Channel
	for _, c := range channels {
		if c.Protocol != protocol {
			continue
		}
		if c.Status != "" && c.Status != "active" {
			continue
		}
		out = append(out, c)
	}
	return out
}

func ChannelForProtocol(channels []Channel, protocol string) *Channel {
	cs := ChannelsForProtocol(channels, protocol)
	if len(cs) == 0 {
		return nil
	}
	c := cs[0]
	return &c
}

func ChannelsForModel(channels []Channel, protocol, model string) []Channel {
	var out []Channel
	for _, c := range ChannelsForProtocol(channels, protocol) {
		if c.ServesModel(model) {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		ri, rj := out[i].Rank(), out[j].Rank()
		if ri != rj {
			return ri < rj
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func PickWeighted(cands []Channel, n uint64) int {
	if len(cands) == 0 {
		return -1
	}
	total := 0
	for _, c := range cands {
		total += c.WeightOrDefault()
	}
	slot := int(n % uint64(total))
	for i, c := range cands {
		slot -= c.WeightOrDefault()
		if slot < 0 {
			return i
		}
	}
	return len(cands) - 1
}
