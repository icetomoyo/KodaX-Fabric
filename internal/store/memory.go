package store

import (
	"context"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Memory is the in-process store used by T1 tests and console tests.
type Memory struct {
	mu sync.Mutex

	ByRawKey map[string]*ResolvedVK

	Operators []Operator
	Passwords map[int64]string
	nextOp    int64

	ProviderKeys []ProviderKeyView
	PKSecrets    map[int64]string
	nextPK       int64

	Pools    []PoolView
	nextPo   int64
	Channels []ChannelView
	nextCh   int64

	VKs    []VirtualKeyView
	VKRaw  map[int64]string
	nextVK int64

	Teams    []TeamView
	nextTeam int64
	Projects []ProjectView
	nextProj int64

	Decisions []RouteDecision
}

func (m *Memory) AddVKUsage(_ context.Context, vkID int64, tokens int, month string) error {
	if m == nil || tokens <= 0 {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, vk := range m.ByRawKey {
		if vk == nil || vk.VirtualKeyID != vkID {
			continue
		}
		if vk.BudgetMonth != month {
			vk.BudgetUsed = 0
			vk.BudgetMonth = month
		}
		vk.BudgetUsed += tokens
	}
	return nil
}

func (m *Memory) SaveRouteDecision(_ context.Context, d RouteDecision) error {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if d.CreatedAt.IsZero() {
		d.CreatedAt = time.Now().UTC()
	}
	m.Decisions = append(m.Decisions, d)
	return nil
}

func (m *Memory) ResolveVK(_ context.Context, rawKey string) (*ResolvedVK, error) {
	if m == nil {
		return nil, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ByRawKey == nil {
		return nil, nil
	}
	vk, ok := m.ByRawKey[rawKey]
	if !ok {
		return nil, nil
	}
	if vk.Status != "" && vk.Status != StatusActive {
		return nil, nil
	}
	cp := *vk
	cp.PoolGroup = NormalizePoolGroup(cp.PoolGroup)
	cp.Channels = IsolateChannels(&cp, vk.Channels)
	return &cp, nil
}

func (m *Memory) DisableProviderKey(_ context.Context, channelID int64) error {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ByRawKey != nil {
		for _, vk := range m.ByRawKey {
			if vk == nil {
				continue
			}
			for i := range vk.Channels {
				if vk.Channels[i].ID == channelID {
					vk.Channels[i].Status = StatusDisabled
				}
			}
		}
	}
	for i := range m.Channels {
		if m.Channels[i].ID == channelID {
			pkID := m.Channels[i].ProviderKeyID
			for j := range m.ProviderKeys {
				if m.ProviderKeys[j].ID == pkID {
					m.ProviderKeys[j].Status = StatusDisabled
				}
			}
		}
	}
	return nil
}

func hashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.MinCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (m *Memory) SeedOperator(phone, name, role, password string) *Operator {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextOp++
	op := Operator{
		ID: m.nextOp, Phone: phone, Name: name, Role: role,
		Status: StatusActive, CreatedAt: time.Now().UTC(),
	}
	m.Operators = append(m.Operators, op)
	if m.Passwords == nil {
		m.Passwords = map[int64]string{}
	}
	h, _ := hashPassword(password)
	m.Passwords[op.ID] = h
	return &op
}
