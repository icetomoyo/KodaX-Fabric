package store

import (
	"context"
	"sync"
)

// Memory is the in-process store used by T1 tests.
type Memory struct {
	mu       sync.Mutex
	ByRawKey map[string]*ResolvedVK
}

func (m *Memory) ResolveVK(_ context.Context, rawKey string) (*ResolvedVK, error) {
	if m == nil || m.ByRawKey == nil {
		return nil, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	vk, ok := m.ByRawKey[rawKey]
	if !ok {
		return nil, nil
	}
	cp := *vk
	cp.Channels = append([]Channel(nil), vk.Channels...)
	return &cp, nil
}

func (m *Memory) AddUsage(_ context.Context, vkID int64, tokens int64) error {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, vk := range m.ByRawKey {
		if vk.VirtualKeyID == vkID {
			vk.MonthlyTokensUsed += tokens
			return nil
		}
	}
	return nil
}
