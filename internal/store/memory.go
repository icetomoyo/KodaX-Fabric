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

func (m *Memory) DisableProviderKey(_ context.Context, channelID int64) error {
	if m == nil || m.ByRawKey == nil {
		return nil
	}
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
