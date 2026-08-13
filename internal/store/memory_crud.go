package store

import (
	"context"

	"kodax-fabric/internal/secret"
)

func (m *Memory) nextID(p *int64) int64 {
	*p++
	return *p
}

func (m *Memory) checkTeam(id int64) error {
	if id == 0 {
		return nil
	}
	if m.Teams == nil {
		return nil
	}
	if _, ok := m.Teams[id]; !ok {
		return badRequest("unknown team")
	}
	return nil
}

func (m *Memory) projectTeam(id int64) (int64, error) {
	if id == 0 {
		return 0, nil
	}
	if m.Projects == nil {
		return 0, badRequest("unknown project")
	}
	tid, ok := m.Projects[id]
	if !ok {
		return 0, badRequest("unknown project")
	}
	return tid, nil
}

func (m *Memory) ListProviders(_ context.Context) ([]ProviderKeyView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []ProviderKeyView
	for id, p := range m.Providers {
		v := providerView(id, p)
		out = append(out, *v)
	}
	return out, nil
}

func (m *Memory) CreateProvider(_ context.Context, in ProviderWrite) (*ProviderKeyView, error) {
	if err := validateProviderWrite(&in); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.checkTeam(in.TeamID); err != nil {
		return nil, err
	}
	if m.Providers == nil {
		m.Providers = map[int64]*ProviderWrite{}
	}
	id := m.nextID(&m.nextProv)
	m.Providers[id] = &ProviderWrite{
		ProviderCode: in.ProviderCode, Secret: in.Secret, Status: in.Status,
		RPMLimit: in.RPMLimit, RPMBurst: in.RPMBurst, TeamID: in.TeamID,
	}
	return providerView(id, m.Providers[id]), nil
}

func (m *Memory) UpdateProvider(_ context.Context, id int64, in ProviderPatch) (*ProviderKeyView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := m.Providers[id]
	if p == nil {
		return nil, ErrNotFound
	}
	if err := applyProviderPatch(p, in); err != nil {
		return nil, err
	}
	if err := m.checkTeam(p.TeamID); err != nil {
		return nil, err
	}
	m.syncProviderRuntime(id)
	return providerView(id, p), nil
}

func (m *Memory) DisableProvider(_ context.Context, id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := m.Providers[id]
	if p == nil {
		return ErrNotFound
	}
	p.Status = StatusDisabled
	m.syncProviderRuntime(id)
	return nil
}

func (m *Memory) ListPools(_ context.Context) ([]ChannelPool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []ChannelPool
	for _, p := range m.Pools {
		out = append(out, *p)
	}
	return out, nil
}

func (m *Memory) CreatePool(_ context.Context, in ChannelPool) (*ChannelPool, error) {
	if err := validatePoolWrite(&in); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.checkTeam(in.TeamID); err != nil {
		return nil, err
	}
	if m.Pools == nil {
		m.Pools = map[int64]*ChannelPool{}
	}
	id := m.nextID(&m.nextPool)
	in.ID = id
	cp := in
	m.Pools[id] = &cp
	return &in, nil
}

func (m *Memory) UpdatePool(_ context.Context, id int64, in PoolPatch) (*ChannelPool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := m.Pools[id]
	if p == nil {
		return nil, ErrNotFound
	}
	if err := applyPoolPatch(p, in); err != nil {
		return nil, err
	}
	if err := m.checkTeam(p.TeamID); err != nil {
		return nil, err
	}
	m.syncPoolRuntime(id)
	out := *p
	return &out, nil
}

func (m *Memory) ListChannelsAdmin(_ context.Context) ([]ChannelAdmin, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []ChannelAdmin
	for _, c := range m.AdminChans {
		out = append(out, *c)
	}
	return out, nil
}

func (m *Memory) CreateChannel(_ context.Context, in ChannelAdmin) (*ChannelAdmin, error) {
	if err := validateChannelWrite(&in); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Pools[in.PoolID] == nil || m.Providers[in.ProviderKeyID] == nil {
		return nil, badRequest("unknown pool or provider")
	}
	if err := ValidateTeamMatch(m.Pools[in.PoolID].TeamID, m.Providers[in.ProviderKeyID].TeamID); err != nil {
		return nil, err
	}
	if m.AdminChans == nil {
		m.AdminChans = map[int64]*ChannelAdmin{}
	}
	id := m.nextID(&m.nextCh)
	in.ID = id
	cp := in
	m.AdminChans[id] = &cp
	m.writeRuntimeChannel(m.buildRuntimeChannel(id))
	return &in, nil
}

func (m *Memory) UpdateChannel(_ context.Context, id int64, in ChannelPatch) (*ChannelAdmin, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.AdminChans[id]
	if c == nil {
		return nil, ErrNotFound
	}
	if err := applyChannelPatch(c, in); err != nil {
		return nil, err
	}
	if m.Pools[c.PoolID] == nil || m.Providers[c.ProviderKeyID] == nil {
		return nil, badRequest("unknown pool or provider")
	}
	if err := ValidateTeamMatch(m.Pools[c.PoolID].TeamID, m.Providers[c.ProviderKeyID].TeamID); err != nil {
		return nil, err
	}
	m.writeRuntimeChannel(m.buildRuntimeChannel(id))
	out := *c
	return &out, nil
}

func (m *Memory) DisableChannel(_ context.Context, id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.AdminChans[id]
	if c == nil {
		return ErrNotFound
	}
	c.Status = StatusDisabled
	m.writeRuntimeChannel(m.buildRuntimeChannel(id))
	return nil
}

func (m *Memory) ListVirtualKeys(_ context.Context) ([]VirtualKeyAdmin, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []VirtualKeyAdmin
	for _, v := range m.AdminVKs {
		cp := *v
		out = append(out, cp)
	}
	return out, nil
}

func (m *Memory) CreateVirtualKey(_ context.Context, in VirtualKeyAdmin) (*VirtualKeyAdmin, string, error) {
	if err := validateVKWrite(&in); err != nil {
		return nil, "", err
	}
	raw, err := secret.NewVK()
	if err != nil {
		return nil, "", err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Pools == nil || m.Pools[in.PoolID] == nil {
		return nil, "", badRequest("unknown pool")
	}
	projTeam, err := m.projectTeam(in.ProjectID)
	if err != nil {
		return nil, "", err
	}
	if in.ProjectID != 0 && projTeam != m.Pools[in.PoolID].TeamID {
		return nil, "", badRequest("team mismatch")
	}
	id := m.nextID(&m.nextVK)
	in.ID = id
	in.KeyPrefix = secret.PrefixVK(raw)
	in.KeyMasked = secret.MaskVK(raw)
	if m.AdminVKs == nil {
		m.AdminVKs = map[int64]*VirtualKeyAdmin{}
	}
	cp := in
	m.AdminVKs[id] = &cp
	if m.ByRawKey == nil {
		m.ByRawKey = map[string]*ResolvedVK{}
	}
	m.ByRawKey[raw] = m.buildResolvedVK(&in)
	return &in, raw, nil
}

func (m *Memory) UpdateVirtualKey(_ context.Context, id int64, in VirtualKeyPatch) (*VirtualKeyAdmin, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v := m.AdminVKs[id]
	if v == nil {
		return nil, ErrNotFound
	}
	if err := applyVKPatch(v, in); err != nil {
		return nil, err
	}
	if m.Pools == nil || m.Pools[v.PoolID] == nil {
		return nil, badRequest("unknown pool")
	}
	projTeam, err := m.projectTeam(v.ProjectID)
	if err != nil {
		return nil, err
	}
	if v.ProjectID != 0 && projTeam != m.Pools[v.PoolID].TeamID {
		return nil, badRequest("team mismatch")
	}
	m.syncVKRuntime(id)
	out := *v
	return &out, nil
}

func (m *Memory) DisableVirtualKey(_ context.Context, id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	v := m.AdminVKs[id]
	if v == nil {
		return ErrNotFound
	}
	v.Status = StatusDisabled
	m.syncVKRuntime(id)
	return nil
}

func (m *Memory) buildRuntimeChannel(id int64) Channel {
	in := m.AdminChans[id]
	prov := m.Providers[in.ProviderKeyID]
	status := in.Status
	if prov != nil && prov.Status != StatusActive {
		status = StatusDisabled
	}
	ch := Channel{
		ID: id, Protocol: in.Protocol, BaseURL: in.BaseURL, Status: status,
		Priority: in.Priority, Weight: in.Weight,
		Models: append([]string(nil), in.Models...),
		PoolID: in.PoolID, ProviderKeyID: in.ProviderKeyID,
	}
	if prov != nil {
		ch.Secret = prov.Secret
		ch.ProviderCode = prov.ProviderCode
		ch.ProviderRPM = prov.RPMLimit
		ch.ProviderBurst = prov.RPMBurst
		ch.KeyTeamID = prov.TeamID
	}
	if pool := m.Pools[in.PoolID]; pool != nil {
		ch.TeamID = pool.TeamID
	}
	return ch
}

func (m *Memory) writeRuntimeChannel(ch Channel) {
	if m.PoolChannels == nil {
		m.PoolChannels = map[int64][]Channel{}
	}
	for pid, chs := range m.PoolChannels {
		kept := chs[:0]
		for _, c := range chs {
			if c.ID != ch.ID {
				kept = append(kept, c)
			}
		}
		m.PoolChannels[pid] = kept
	}
	m.PoolChannels[ch.PoolID] = append(m.PoolChannels[ch.PoolID], ch)
	for _, vk := range m.ByRawKey {
		if vk == nil {
			continue
		}
		kept := vk.Channels[:0]
		for _, c := range vk.Channels {
			if c.ID != ch.ID {
				kept = append(kept, c)
			}
		}
		if vk.PoolID == ch.PoolID {
			kept = append(kept, ch)
		}
		vk.Channels = kept
	}
}

func (m *Memory) syncProviderRuntime(id int64) {
	for cid, c := range m.AdminChans {
		if c != nil && c.ProviderKeyID == id {
			m.writeRuntimeChannel(m.buildRuntimeChannel(cid))
		}
	}
}

func (m *Memory) syncPoolRuntime(id int64) {
	pool := m.Pools[id]
	if pool == nil {
		return
	}
	for cid, c := range m.AdminChans {
		if c != nil && c.PoolID == id {
			m.writeRuntimeChannel(m.buildRuntimeChannel(cid))
		}
	}
	for _, vk := range m.ByRawKey {
		if vk == nil || vk.PoolID != id {
			continue
		}
		vk.PoolName = pool.Name
		vk.PoolGroup = pool.GroupName
		if vk.ProjectID == 0 {
			vk.TeamID = pool.TeamID
		}
	}
}

func (m *Memory) buildResolvedVK(in *VirtualKeyAdmin) *ResolvedVK {
	pool := m.Pools[in.PoolID]
	out := &ResolvedVK{
		VirtualKeyID: in.ID, PoolID: in.PoolID, ProjectID: in.ProjectID,
		ExpiresAt: in.ExpiresAt, ModelScope: append([]string(nil), in.ModelScope...),
		IPAllow: append([]string(nil), in.IPAllow...), RPMLimit: in.RPMLimit, RPMBurst: in.RPMBurst,
		MonthlyHard: in.MonthlyHard, MonthlySoft: in.MonthlySoft,
	}
	if pool != nil {
		out.PoolName = pool.Name
		out.PoolGroup = pool.GroupName
		out.TeamID = pool.TeamID
	}
	if in.ProjectID != 0 && m.Projects != nil {
		if tid, ok := m.Projects[in.ProjectID]; ok {
			out.TeamID = tid
		}
	}
	if m.PoolChannels != nil {
		out.Channels = append([]Channel(nil), m.PoolChannels[in.PoolID]...)
	}
	return out
}

func (m *Memory) syncVKRuntime(id int64) {
	v := m.AdminVKs[id]
	if v == nil {
		return
	}
	for raw, vk := range m.ByRawKey {
		if vk == nil || vk.VirtualKeyID != id {
			continue
		}
		if v.Status != StatusActive {
			delete(m.ByRawKey, raw)
			continue
		}
		fresh := m.buildResolvedVK(v)
		*vk = *fresh
	}
}
