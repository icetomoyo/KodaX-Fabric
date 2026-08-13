package store

import (
	"context"
	"time"

	"kodax-fabric/internal/secret"
)

func (m *Memory) CreateVKApplication(_ context.Context, app VKApplication) (*VKApplication, error) {
	if m == nil {
		return nil, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Apps == nil {
		m.Apps = map[int64]*VKApplication{}
	}
	m.nextApp++
	app.ID = m.nextApp
	app.Status = AppPending
	app.CreatedAt = time.Now().UTC()
	cp := app
	m.Apps[app.ID] = &cp
	out := cp
	return &out, nil
}

func (m *Memory) GetVKApplication(_ context.Context, id int64) (*VKApplication, error) {
	if m == nil || m.Apps == nil {
		return nil, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	a := m.Apps[id]
	if a == nil {
		return nil, nil
	}
	cp := *a
	return &cp, nil
}

func (m *Memory) ListVKApplications(_ context.Context) ([]VKApplication, error) {
	if m == nil || m.Apps == nil {
		return nil, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]VKApplication, 0, len(m.Apps))
	for _, a := range m.Apps {
		out = append(out, *a)
	}
	return out, nil
}

func (m *Memory) ApproveVKApplication(_ context.Context, id int64, _ time.Time) (*VKApplication, string, error) {
	if m == nil {
		return nil, "", nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	a := m.Apps[id]
	if a == nil {
		return nil, "", nil
	}
	if a.Status != AppPending {
		cp := *a
		return &cp, "", ErrAlreadyDecided
	}
	raw, err := secret.NewVK()
	if err != nil {
		return nil, "", err
	}
	m.nextVK++
	vkID := m.nextVK
	if vkID == 0 {
		vkID = 1
		m.nextVK = 1
	}
	a.Status = AppApproved
	a.VirtualKeyID = vkID
	a.KeyPrefix = secret.PrefixVK(raw)
	a.KeyMasked = secret.MaskVK(raw)
	if m.ByRawKey == nil {
		m.ByRawKey = map[string]*ResolvedVK{}
	}
	var chs []Channel
	if m.PoolChannels != nil {
		chs = append([]Channel(nil), m.PoolChannels[a.PoolID]...)
	}
	m.ByRawKey[raw] = &ResolvedVK{
		VirtualKeyID: vkID,
		PoolID:       a.PoolID,
		TeamID:       a.TeamID,
		ProjectID:    a.ProjectID,
		ExpiresAt:    a.ExpiresAt,
		ModelScope:   append([]string(nil), a.ModelScope...),
		MonthlyHard:  a.MonthlyHard,
		MonthlySoft:  a.MonthlySoft,
		IPAllow:      append([]string(nil), a.IPAllow...),
		Channels:     chs,
	}
	cp := *a
	return &cp, raw, nil
}

func (m *Memory) RejectVKApplication(_ context.Context, id int64, reason string) (*VKApplication, error) {
	if m == nil || m.Apps == nil {
		return nil, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	a := m.Apps[id]
	if a == nil {
		return nil, nil
	}
	if a.Status != AppPending {
		cp := *a
		return &cp, ErrAlreadyDecided
	}
	a.Status = AppRejected
	a.RejectReason = reason
	cp := *a
	return &cp, nil
}

func (m *Memory) StageProviderRotation(_ context.Context, keyID int64, secretPlain string, activate, retire *time.Time, now time.Time) error {
	if m == nil {
		return ErrKeyNotFound
	}
	act, ret, err := NormalizeRotationSchedule(activate, retire)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var found bool
	var stageErr error
	m.touchKey(keyID, func(ch *Channel) {
		found = true
		if ch.Replacement != "" {
			pending, overlap, done := ReplacementPhase(true, ch.ActivateAt, ch.RetireAt, now)
			if pending || overlap {
				stageErr = ErrRotationConflict
				return
			}
			if done {
				ch.Secret = ch.Replacement
			}
			ch.Replacement = ""
			ch.ActivateAt = nil
			ch.RetireAt = nil
		}
		ch.Replacement = secretPlain
		ch.ActivateAt = cloneTime(act)
		ch.RetireAt = cloneTime(ret)
		if ch.ProviderKeyID == 0 {
			ch.ProviderKeyID = keyID
		}
	})
	if stageErr != nil {
		return stageErr
	}
	if !found {
		return ErrKeyNotFound
	}
	return nil
}

func (m *Memory) ActivateProviderRotation(_ context.Context, keyID int64, now time.Time) error {
	if m == nil {
		return ErrKeyNotFound
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var found bool
	var actErr error
	t := now
	m.touchKey(keyID, func(ch *Channel) {
		found = true
		if ch.Replacement == "" {
			actErr = ErrNoReplacement
			return
		}
		ch.ActivateAt = &t
		if ch.RetireAt == nil {
			g := t.Add(DefaultRotationGrace)
			ch.RetireAt = &g
		}
		if !ch.RetireAt.After(*ch.ActivateAt) {
			actErr = ErrInvalidRotationSchedule
		}
	})
	if actErr != nil {
		return actErr
	}
	if !found {
		return ErrKeyNotFound
	}
	return nil
}

func (m *Memory) ListProviderKeys(_ context.Context) ([]ProviderKeyView, error) {
	if m == nil {
		return nil, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	seen := map[int64]ProviderKeyView{}
	for _, vk := range m.ByRawKey {
		if vk == nil {
			continue
		}
		for _, c := range vk.Channels {
			id := c.ProviderKeyID
			if id == 0 {
				id = c.ID
			}
			seen[id] = ProviderKeyView{
				ID:             id,
				ProviderCode:   c.ProviderCode,
				Status:         c.Status,
				TeamID:         c.KeyTeamID,
				RPMLimit:       c.ProviderRPM,
				RPMBurst:       c.ProviderBurst,
				HasReplacement: c.Replacement != "",
				ActivateAt:     c.ActivateAt,
				RetireAt:       c.RetireAt,
			}
		}
	}
	out := make([]ProviderKeyView, 0, len(seen))
	for _, v := range seen {
		out = append(out, v)
	}
	return out, nil
}

func (m *Memory) touchKey(keyID int64, fn func(*Channel)) {
	if m.ByRawKey == nil {
		return
	}
	for _, vk := range m.ByRawKey {
		if vk == nil {
			continue
		}
		for i := range vk.Channels {
			id := vk.Channels[i].ProviderKeyID
			if id == 0 {
				id = vk.Channels[i].ID
			}
			if id == keyID {
				fn(&vk.Channels[i])
			}
		}
	}
}

func cloneTime(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	c := *t
	return &c
}
