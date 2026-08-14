package store

import (
	"context"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func (m *Memory) AuthenticateOperator(_ context.Context, phone, password string) (*Operator, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	phone = strings.TrimSpace(phone)
	for i := range m.Operators {
		op := m.Operators[i]
		if op.Phone != phone {
			continue
		}
		if op.Status != StatusActive {
			return nil, nil
		}
		if err := bcrypt.CompareHashAndPassword([]byte(m.Passwords[op.ID]), []byte(password)); err != nil {
			return nil, nil
		}
		cp := op
		cp.Role = CanonicalRole(cp.Role)
		return &cp, nil
	}
	return nil, nil
}

func (m *Memory) GetOperator(_ context.Context, id int64) (*Operator, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.Operators {
		if m.Operators[i].ID == id {
			cp := m.Operators[i]
			cp.Role = CanonicalRole(cp.Role)
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (m *Memory) ListOperators(_ context.Context) ([]Operator, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Operator, len(m.Operators))
	copy(out, m.Operators)
	for i := range out {
		out[i].Role = CanonicalRole(out[i].Role)
	}
	return out, nil
}

func (m *Memory) CreateOperator(_ context.Context, in OperatorCreate) (*Operator, error) {
	role, err := NormalizeRole(in.Role)
	if err != nil {
		return nil, err
	}
	if err := RequireTeamForRole(role, in.TeamID); err != nil {
		return nil, err
	}
	phone := strings.TrimSpace(in.Phone)
	if phone == "" || len(in.Password) < 8 {
		return nil, ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, op := range m.Operators {
		if op.Phone == phone {
			return nil, ErrConflict
		}
	}
	h, err := hashPassword(in.Password)
	if err != nil {
		return nil, err
	}
	m.nextOp++
	if in.TeamID > 0 && !m.hasTeam(in.TeamID) {
		return nil, ErrInvalid
	}
	op := Operator{
		ID: m.nextOp, Phone: phone, Name: strings.TrimSpace(in.Name),
		Role: role, Status: StatusActive, TeamID: in.TeamID, CreatedAt: time.Now().UTC(),
	}
	m.Operators = append(m.Operators, op)
	if m.Passwords == nil {
		m.Passwords = map[int64]string{}
	}
	m.Passwords[op.ID] = h
	return &op, nil
}

func (m *Memory) UpdateOperator(_ context.Context, id int64, in OperatorUpdate) (*Operator, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	idx := -1
	for i := range m.Operators {
		if m.Operators[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, ErrNotFound
	}
	next := m.Operators[idx]
	if in.Name != nil {
		next.Name = strings.TrimSpace(*in.Name)
	}
	if in.Role != nil {
		role, err := NormalizeRole(*in.Role)
		if err != nil {
			return nil, err
		}
		next.Role = role
	}
	if in.Status != nil {
		st, err := NormalizeStatus(*in.Status)
		if err != nil {
			return nil, err
		}
		next.Status = st
	}
	if err := guardLastAdmin(m.Operators, next); err != nil {
		return nil, err
	}
	if in.Password != nil {
		if len(*in.Password) < 8 {
			return nil, ErrInvalid
		}
		h, err := hashPassword(*in.Password)
		if err != nil {
			return nil, err
		}
		m.Passwords[id] = h
	}
	m.Operators[idx] = next
	return &next, nil
}

func guardLastAdmin(ops []Operator, next Operator) error {
	activeAdmins := 0
	for _, op := range ops {
		if IsOrgAdmin(op.Role) && op.Status == StatusActive && op.ID != next.ID {
			activeAdmins++
		}
	}
	if IsOrgAdmin(next.Role) && next.Status == StatusActive {
		activeAdmins++
	}
	if activeAdmins < 1 {
		return ErrForbidden
	}
	return nil
}

func (m *Memory) Overview(_ context.Context) (*Overview, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ov := &Overview{
		Operators:    len(m.Operators),
		ProviderKeys: len(m.ProviderKeys),
		Pools:        len(m.Pools),
		Channels:     len(m.Channels),
		VirtualKeys:  len(m.VKs),
		Teams:        len(m.Teams),
		Projects:     len(m.Projects),
	}
	for _, k := range m.ProviderKeys {
		if k.Status == StatusActive {
			ov.ActiveKeys++
		} else {
			ov.DisabledKeys++
		}
	}
	return ov, nil
}

func (m *Memory) ListProviderKeys(_ context.Context) ([]ProviderKeyView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]ProviderKeyView, len(m.ProviderKeys))
	copy(out, m.ProviderKeys)
	return out, nil
}

func (m *Memory) CreateProviderKey(_ context.Context, in ProviderKeyCreate) (*ProviderKeyView, error) {
	code := strings.TrimSpace(in.ProviderCode)
	if code == "" || strings.TrimSpace(in.Secret) == "" {
		return nil, ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if in.TeamID > 0 && !m.hasTeam(in.TeamID) {
		return nil, ErrInvalid
	}
	m.nextPK++
	row := ProviderKeyView{ID: m.nextPK, ProviderCode: code, Status: StatusActive, TeamID: in.TeamID, RPMLimit: in.RPMLimit}
	m.ProviderKeys = append(m.ProviderKeys, row)
	if m.PKSecrets == nil {
		m.PKSecrets = map[int64]string{}
	}
	m.PKSecrets[row.ID] = in.Secret
	return &row, nil
}

func (m *Memory) UpdateProviderKey(_ context.Context, id int64, in ProviderKeyUpdate) (*ProviderKeyView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.ProviderKeys {
		if m.ProviderKeys[i].ID != id {
			continue
		}
		if in.Status != nil {
			st, err := NormalizeStatus(*in.Status)
			if err != nil {
				return nil, err
			}
			m.ProviderKeys[i].Status = st
		}
		if in.TeamID != nil {
			if *in.TeamID > 0 && !m.hasTeam(*in.TeamID) {
				return nil, ErrInvalid
			}
			m.ProviderKeys[i].TeamID = *in.TeamID
		}
		if in.RPMLimit != nil {
			if *in.RPMLimit < 0 {
				return nil, ErrInvalid
			}
			m.ProviderKeys[i].RPMLimit = *in.RPMLimit
		}
		cp := m.ProviderKeys[i]
		return &cp, nil
	}
	return nil, ErrNotFound
}

func (m *Memory) ListPools(_ context.Context) ([]PoolView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]PoolView, len(m.Pools))
	copy(out, m.Pools)
	return out, nil
}

func (m *Memory) CreatePool(_ context.Context, in PoolCreate) (*PoolView, error) {
	name := strings.TrimSpace(in.Name)
	g := NormalizeGroup(in.GroupName)
	if name == "" || g == "" {
		return nil, ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if in.TeamID > 0 && !m.hasTeam(in.TeamID) {
		return nil, ErrInvalid
	}
	m.nextPo++
	row := PoolView{ID: m.nextPo, Name: name, GroupName: g, TeamID: in.TeamID}
	m.Pools = append(m.Pools, row)
	return &row, nil
}

func (m *Memory) UpdatePool(_ context.Context, id int64, in PoolUpdate) (*PoolView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.Pools {
		if m.Pools[i].ID != id {
			continue
		}
		if in.Name != nil {
			n := strings.TrimSpace(*in.Name)
			if n == "" {
				return nil, ErrInvalid
			}
			m.Pools[i].Name = n
		}
		if in.GroupName != nil {
			g := NormalizeGroup(*in.GroupName)
			if g == "" {
				return nil, ErrInvalid
			}
			m.Pools[i].GroupName = g
		}
		if in.TeamID != nil {
			if *in.TeamID > 0 && !m.hasTeam(*in.TeamID) {
				return nil, ErrInvalid
			}
			m.Pools[i].TeamID = *in.TeamID
		}
		cp := m.Pools[i]
		return &cp, nil
	}
	return nil, ErrNotFound
}

func (m *Memory) ListChannels(_ context.Context) ([]ChannelView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]ChannelView, len(m.Channels))
	copy(out, m.Channels)
	return out, nil
}

func (m *Memory) CreateChannel(_ context.Context, in ChannelCreate) (*ChannelView, error) {
	proto, err := NormalizeProtocol(in.Protocol)
	if err != nil {
		return nil, err
	}
	if in.PoolID == 0 || in.ProviderKeyID == 0 || strings.TrimSpace(in.BaseURL) == "" {
		return nil, ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.hasPool(in.PoolID) || !m.hasPK(in.ProviderKeyID) {
		return nil, ErrInvalid
	}
	m.nextCh++
	row := ChannelView{
		ID: m.nextCh, PoolID: in.PoolID, ProviderKeyID: in.ProviderKeyID,
		Protocol: proto, BaseURL: strings.TrimSpace(in.BaseURL), Status: StatusActive,
	}
	m.Channels = append(m.Channels, row)
	return &row, nil
}

func (m *Memory) UpdateChannel(_ context.Context, id int64, in ChannelUpdate) (*ChannelView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.Channels {
		if m.Channels[i].ID != id {
			continue
		}
		if in.Status != nil {
			st, err := NormalizeStatus(*in.Status)
			if err != nil {
				return nil, err
			}
			m.Channels[i].Status = st
		}
		if in.BaseURL != nil {
			m.Channels[i].BaseURL = strings.TrimSpace(*in.BaseURL)
		}
		cp := m.Channels[i]
		return &cp, nil
	}
	return nil, ErrNotFound
}

func (m *Memory) ListVirtualKeys(_ context.Context, ownerID int64) ([]VirtualKeyView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []VirtualKeyView
	for _, vk := range m.VKs {
		if ownerID > 0 && vk.OwnerID != ownerID {
			continue
		}
		out = append(out, vk)
	}
	if out == nil {
		out = []VirtualKeyView{}
	}
	return out, nil
}

func (m *Memory) CreateVirtualKey(_ context.Context, in VirtualKeyCreate) (*VirtualKeyCreated, error) {
	if in.PoolID == 0 {
		return nil, ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.hasPool(in.PoolID) {
		return nil, ErrInvalid
	}
	if in.OwnerID > 0 && !m.hasOp(in.OwnerID) {
		return nil, ErrInvalid
	}
	var teamID int64
	if in.ProjectID > 0 {
		pr := m.project(in.ProjectID)
		if pr == nil {
			return nil, ErrInvalid
		}
		teamID = pr.TeamID
	}
	raw, prefix := GenerateVK()
	m.nextVK++
	view := VirtualKeyView{
		ID: m.nextVK, PoolID: in.PoolID, OwnerID: in.OwnerID, ProjectID: in.ProjectID,
		Status: StatusActive, KeyPrefix: prefix, KeyMasked: MaskPrefix(prefix),
	}
	m.VKs = append(m.VKs, view)
	if m.VKRaw == nil {
		m.VKRaw = map[int64]string{}
	}
	m.VKRaw[view.ID] = raw
	if m.ByRawKey == nil {
		m.ByRawKey = map[string]*ResolvedVK{}
	}
	m.ByRawKey[raw] = &ResolvedVK{VirtualKeyID: view.ID, PoolID: view.PoolID, ProjectID: in.ProjectID, TeamID: teamID}
	return &VirtualKeyCreated{VirtualKeyView: view, Secret: raw}, nil
}

func (m *Memory) UpdateVirtualKey(_ context.Context, id int64, in VirtualKeyUpdate) (*VirtualKeyView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.VKs {
		if m.VKs[i].ID != id {
			continue
		}
		if in.Status != nil {
			st, err := NormalizeStatus(*in.Status)
			if err != nil {
				return nil, err
			}
			if m.VKs[i].Status == StatusPending && st == StatusActive {
				return nil, ErrInvalid
			}
			m.VKs[i].Status = st
		}
		if in.OwnerID != nil {
			if *in.OwnerID > 0 && !m.hasOp(*in.OwnerID) {
				return nil, ErrInvalid
			}
			m.VKs[i].OwnerID = *in.OwnerID
		}
		if in.PoolID != nil {
			if !m.hasPool(*in.PoolID) {
				return nil, ErrInvalid
			}
			m.VKs[i].PoolID = *in.PoolID
		}
		if in.ProjectID != nil {
			if *in.ProjectID > 0 && m.project(*in.ProjectID) == nil {
				return nil, ErrInvalid
			}
			m.VKs[i].ProjectID = *in.ProjectID
		}
		cp := m.VKs[i]
		return &cp, nil
	}
	return nil, ErrNotFound
}

func (m *Memory) ApplyVirtualKey(_ context.Context, in VirtualKeyCreate) (*VirtualKeyView, error) {
	if in.PoolID == 0 {
		return nil, ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.hasPool(in.PoolID) {
		return nil, ErrInvalid
	}
	m.nextVK++
	view := VirtualKeyView{
		ID: m.nextVK, PoolID: in.PoolID, OwnerID: in.OwnerID, ProjectID: in.ProjectID,
		Status: StatusPending, KeyPrefix: "fab-", KeyMasked: MaskPrefix("fab-"),
	}
	m.VKs = append(m.VKs, view)
	return &view, nil
}

func (m *Memory) ApproveVirtualKey(_ context.Context, id int64) (*VirtualKeyCreated, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.VKs {
		if m.VKs[i].ID != id {
			continue
		}
		if m.VKs[i].Status != StatusPending {
			return nil, ErrInvalid
		}
		raw, prefix := GenerateVK()
		m.VKs[i].Status = StatusActive
		m.VKs[i].KeyPrefix = prefix
		m.VKs[i].KeyMasked = MaskPrefix(prefix)
		if m.VKRaw == nil {
			m.VKRaw = map[int64]string{}
		}
		m.VKRaw[id] = raw
		if m.ByRawKey == nil {
			m.ByRawKey = map[string]*ResolvedVK{}
		}
		var teamID int64
		if pr := m.project(m.VKs[i].ProjectID); pr != nil {
			teamID = pr.TeamID
		}
		m.ByRawKey[raw] = &ResolvedVK{
			VirtualKeyID: id, PoolID: m.VKs[i].PoolID, ProjectID: m.VKs[i].ProjectID, TeamID: teamID,
		}
		return &VirtualKeyCreated{VirtualKeyView: m.VKs[i], Secret: raw}, nil
	}
	return nil, ErrNotFound
}

func (m *Memory) hasPool(id int64) bool {
	for _, p := range m.Pools {
		if p.ID == id {
			return true
		}
	}
	return false
}

func (m *Memory) hasPK(id int64) bool {
	for _, p := range m.ProviderKeys {
		if p.ID == id {
			return true
		}
	}
	return false
}

func (m *Memory) hasOp(id int64) bool {
	for _, p := range m.Operators {
		if p.ID == id {
			return true
		}
	}
	return false
}

func (m *Memory) hasTeam(id int64) bool {
	for _, t := range m.Teams {
		if t.ID == id {
			return true
		}
	}
	return false
}

func (m *Memory) project(id int64) *ProjectView {
	for i := range m.Projects {
		if m.Projects[i].ID == id {
			return &m.Projects[i]
		}
	}
	return nil
}

func (m *Memory) ListTeams(_ context.Context) ([]TeamView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]TeamView, len(m.Teams))
	copy(out, m.Teams)
	return out, nil
}

func (m *Memory) CreateTeam(_ context.Context, in TeamCreate) (*TeamView, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextTeam++
	row := TeamView{ID: m.nextTeam, Name: name}
	m.Teams = append(m.Teams, row)
	return &row, nil
}

func (m *Memory) ListProjects(_ context.Context) ([]ProjectView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]ProjectView, len(m.Projects))
	copy(out, m.Projects)
	return out, nil
}

func (m *Memory) CreateProject(_ context.Context, in ProjectCreate) (*ProjectView, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || in.TeamID == 0 {
		return nil, ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.hasTeam(in.TeamID) {
		return nil, ErrInvalid
	}
	m.nextProj++
	row := ProjectView{ID: m.nextProj, TeamID: in.TeamID, Name: name}
	m.Projects = append(m.Projects, row)
	return &row, nil
}

func (m *Memory) ListRouteDecisions(_ context.Context, limit int) ([]RouteDecision, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	n := len(m.Decisions)
	if n == 0 {
		return []RouteDecision{}, nil
	}
	start := n - limit
	if start < 0 {
		start = 0
	}
	out := make([]RouteDecision, n-start)
	for i, d := range m.Decisions[start:] {
		out[len(out)-1-i] = d
	}
	return out, nil
}

func (m *Memory) ListModelAliases(_ context.Context) ([]ModelAlias, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]ModelAlias, len(m.AliasList))
	copy(out, m.AliasList)
	if out == nil {
		out = []ModelAlias{}
	}
	return out, nil
}

func (m *Memory) PutModelAlias(_ context.Context, in ModelAlias) (*ModelAlias, error) {
	row, err := NormalizeModelAlias(in)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.AliasList {
		if m.AliasList[i].Protocol == row.Protocol && m.AliasList[i].Model == row.Model {
			m.AliasList[i] = row
			return &row, nil
		}
	}
	m.AliasList = append(m.AliasList, row)
	return &row, nil
}
