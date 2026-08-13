package store

import (
	"context"
	"sync"
)

// Memory is the in-process store used by T1 tests.
type Memory struct {
	mu           sync.Mutex
	ByRawKey     map[string]*ResolvedVK
	Aliases      map[string][]string
	Routes       []RouteDecision
	Apps         map[int64]*VKApplication
	PoolChannels map[int64][]Channel
	nextApp      int64
	nextVK       int64
}

func (m *Memory) ResolveVK(_ context.Context, rawKey string) (*ResolvedVK, error) {
	if m == nil || m.ByRawKey == nil {
		return nil, nil
	}
	vk, ok := m.ByRawKey[rawKey]
	if !ok {
		return nil, nil
	}
	return IsolateChannels(vk), nil
}

func (m *Memory) DisableProviderKey(_ context.Context, channelID int64) error {
	if m == nil || m.ByRawKey == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, vk := range m.ByRawKey {
		if vk == nil {
			continue
		}
		for i := range vk.Channels {
			if vk.Channels[i].ID == channelID {
				vk.Channels[i].Status = "disabled"
			}
		}
	}
	return nil
}

func (m *Memory) LookupAlias(_ context.Context, model string) ([]string, error) {
	if m != nil && m.Aliases != nil {
		if t := m.Aliases[model]; len(t) > 0 {
			return append([]string(nil), t...), nil
		}
	}
	if model == "" {
		return nil, nil
	}
	return []string{model}, nil
}

func (m *Memory) RecordRoute(_ context.Context, d RouteDecision) error {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	m.Routes = append(m.Routes, d)
	m.mu.Unlock()
	return nil
}

func (m *Memory) RecentRoutes(_ context.Context, vkID int64) ([]RouteDecision, error) {
	if m == nil {
		return nil, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []RouteDecision
	for _, d := range m.Routes {
		if vkID == 0 || d.VirtualKeyID == vkID {
			out = append(out, d)
		}
	}
	return out, nil
}
