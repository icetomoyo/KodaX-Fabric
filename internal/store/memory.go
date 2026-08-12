package store

import "context"

// Memory is the in-process store used by T1 tests.
type Memory struct {
	ByRawKey map[string]*ResolvedVK
}

func (m *Memory) ResolveVK(_ context.Context, rawKey string) (*ResolvedVK, error) {
	if m == nil || m.ByRawKey == nil {
		return nil, nil
	}
	vk, ok := m.ByRawKey[rawKey]
	if !ok {
		return nil, nil
	}
	return vk, nil
}
