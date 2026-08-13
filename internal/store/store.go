package store

import (
	"context"
	"sort"
	"time"
)

const (
	ProtocolOpenAI    = "openai_chat"
	ProtocolAnthropic = "anthropic_messages"
)

type Channel struct {
	ID            int64
	Protocol      string
	BaseURL       string
	Secret        string
	Status        string
	Priority      int
	Weight        int
	Models        []string
	PoolID        int64
	TeamID        int64
	KeyTeamID     int64
	ProviderCode  string
	ProviderRPM   int
	ProviderBurst int
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
