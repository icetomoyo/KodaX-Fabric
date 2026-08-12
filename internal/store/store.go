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
	ID       int64
	PoolID   int64
	Protocol string
	BaseURL  string
	Secret   string
	Priority int
	Weight   int
	Status   string
}

type ResolvedVK struct {
	VirtualKeyID      int64
	PoolID            int64
	Name              string
	RPMLimit          int
	MonthlyTokenLimit int64
	MonthlyTokensUsed int64
	ExpiresAt         *time.Time
	ModelScope        []string
	IPWhitelist       []string
	Channels          []Channel
}

type Store interface {
	ResolveVK(ctx context.Context, rawKey string) (*ResolvedVK, error)
	AddUsage(ctx context.Context, vkID int64, tokens int64) error
}

func ChannelsForProtocol(channels []Channel, protocol string) []Channel {
	var out []Channel
	for _, c := range channels {
		if c.Protocol == protocol && (c.Status == "" || c.Status == "active") {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Priority != out[j].Priority {
			return out[i].Priority > out[j].Priority
		}
		return out[i].Weight > out[j].Weight
	})
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
