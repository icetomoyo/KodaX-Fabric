package store

import "context"

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
}

type ResolvedVK struct {
	VirtualKeyID int64
	PoolID       int64
	Channels     []Channel
}

type Store interface {
	ResolveVK(ctx context.Context, rawKey string) (*ResolvedVK, error)
	DisableProviderKey(ctx context.Context, channelID int64) error
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
