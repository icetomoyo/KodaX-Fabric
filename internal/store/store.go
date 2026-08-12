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
}

type ResolvedVK struct {
	VirtualKeyID int64
	PoolID       int64
	Channels     []Channel
}

type Store interface {
	ResolveVK(ctx context.Context, rawKey string) (*ResolvedVK, error)
}

func ChannelForProtocol(channels []Channel, protocol string) *Channel {
	for i := range channels {
		if channels[i].Protocol == protocol {
			c := channels[i]
			return &c
		}
	}
	return nil
}
