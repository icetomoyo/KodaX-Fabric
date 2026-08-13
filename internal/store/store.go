package store

import (
	"context"
	"strings"
	"time"
)

const (
	ProtocolOpenAI    = "openai_chat"
	ProtocolAnthropic = "anthropic_messages"
)

type Channel struct {
	ID       int64
	Protocol string
	BaseURL  string
	Secret   string
	Status   string
	Priority int
	Weight   int
	Models   []string
}

type ResolvedVK struct {
	VirtualKeyID int64
	PoolID       int64
	ExpiresAt    *time.Time
	ModelScope   []string
	Channels     []Channel
}

type RouteDecision struct {
	RequestID string
	ChannelID int64
	Reason    string
	Fallback  bool
}

type Store interface {
	ResolveVK(ctx context.Context, rawKey string) (*ResolvedVK, error)
	DisableProviderKey(ctx context.Context, channelID int64) error
	SaveRouteDecision(ctx context.Context, d RouteDecision) error
}

func ModelAllowed(scope []string, model string) bool {
	if len(scope) == 0 {
		return true
	}
	if model == "" {
		return false
	}
	for _, s := range scope {
		if s == model {
			return true
		}
	}
	return false
}

func parseModelScope(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(raw, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func ChannelServes(c Channel, model string) bool {
	if len(c.Models) == 0 {
		return true
	}
	for _, m := range c.Models {
		if m == model {
			return true
		}
	}
	return false
}

func PriorityRank(p int) int {
	if p > 0 {
		return p
	}
	return 1_000_000
}

func EffectiveWeight(w int) int {
	if w <= 0 {
		return 1
	}
	return w
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
