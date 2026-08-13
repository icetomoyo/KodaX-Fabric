package store

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"kodax-fabric/internal/secret"
)

func scanOperator(s interface {
	Scan(dest ...any) error
}) (*Operator, string, error) {
	var op Operator
	var hash string
	var created time.Time
	if err := s.Scan(&op.ID, &op.Phone, &op.Name, &op.Role, &op.Status, &hash, &created); err != nil {
		return nil, "", err
	}
	op.CreatedAt = created.UTC()
	return &op, hash, nil
}

func (p *Postgres) AuthenticateOperator(ctx context.Context, phone, password string) (*Operator, error) {
	row := p.DB.QueryRowContext(ctx, `
SELECT id, phone, COALESCE(name,''), role, COALESCE(status,'active'), password_hash, COALESCE(created_at, now())
FROM operators WHERE phone = $1
`, strings.TrimSpace(phone))
	op, hash, err := scanOperator(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if op.Status != StatusActive {
		return nil, nil
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return nil, nil
	}
	return op, nil
}

func (p *Postgres) GetOperator(ctx context.Context, id int64) (*Operator, error) {
	row := p.DB.QueryRowContext(ctx, `
SELECT id, phone, COALESCE(name,''), role, COALESCE(status,'active'), password_hash, COALESCE(created_at, now())
FROM operators WHERE id = $1
`, id)
	op, _, err := scanOperator(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return op, err
}

func (p *Postgres) ListOperators(ctx context.Context) ([]Operator, error) {
	rows, err := p.DB.QueryContext(ctx, `
SELECT id, phone, COALESCE(name,''), role, COALESCE(status,'active'), password_hash, COALESCE(created_at, now())
FROM operators ORDER BY id
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Operator
	for rows.Next() {
		op, _, err := scanOperator(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *op)
	}
	if out == nil {
		out = []Operator{}
	}
	return out, rows.Err()
}

func (p *Postgres) CreateOperator(ctx context.Context, in OperatorCreate) (*Operator, error) {
	role, err := NormalizeRole(in.Role)
	if err != nil {
		return nil, err
	}
	phone := strings.TrimSpace(in.Phone)
	if phone == "" || len(in.Password) < 8 {
		return nil, ErrInvalid
	}
	h, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	var id int64
	var created time.Time
	err = p.DB.QueryRowContext(ctx, `
INSERT INTO operators (phone, password_hash, role, name, status)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, created_at
`, phone, string(h), role, strings.TrimSpace(in.Name), StatusActive).Scan(&id, &created)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return nil, ErrConflict
		}
		return nil, err
	}
	return &Operator{ID: id, Phone: phone, Name: strings.TrimSpace(in.Name), Role: role, Status: StatusActive, CreatedAt: created.UTC()}, nil
}

func (p *Postgres) UpdateOperator(ctx context.Context, id int64, in OperatorUpdate) (*Operator, error) {
	cur, err := p.GetOperator(ctx, id)
	if err != nil {
		return nil, err
	}
	next := *cur
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
	all, err := p.ListOperators(ctx)
	if err != nil {
		return nil, err
	}
	if err := guardLastAdmin(all, next); err != nil {
		return nil, err
	}
	if in.Password != nil {
		if len(*in.Password) < 8 {
			return nil, ErrInvalid
		}
		h, err := bcrypt.GenerateFromPassword([]byte(*in.Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		if _, err := p.DB.ExecContext(ctx, `
UPDATE operators SET name=$2, role=$3, status=$4, password_hash=$5 WHERE id=$1
`, id, next.Name, next.Role, next.Status, string(h)); err != nil {
			return nil, err
		}
	} else if _, err := p.DB.ExecContext(ctx, `
UPDATE operators SET name=$2, role=$3, status=$4 WHERE id=$1
`, id, next.Name, next.Role, next.Status); err != nil {
		return nil, err
	}
	return p.GetOperator(ctx, id)
}

func (p *Postgres) Overview(ctx context.Context) (*Overview, error) {
	ov := &Overview{}
	if err := p.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM operators`).Scan(&ov.Operators); err != nil {
		return nil, err
	}
	if err := p.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM provider_keys`).Scan(&ov.ProviderKeys); err != nil {
		return nil, err
	}
	if err := p.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM provider_keys WHERE status='active'`).Scan(&ov.ActiveKeys); err != nil {
		return nil, err
	}
	if err := p.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM provider_keys WHERE status<>'active'`).Scan(&ov.DisabledKeys); err != nil {
		return nil, err
	}
	if err := p.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM channel_pools`).Scan(&ov.Pools); err != nil {
		return nil, err
	}
	if err := p.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM channels`).Scan(&ov.Channels); err != nil {
		return nil, err
	}
	if err := p.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM virtual_keys`).Scan(&ov.VirtualKeys); err != nil {
		return nil, err
	}
	return ov, nil
}

func (p *Postgres) ListProviderKeys(ctx context.Context) ([]ProviderKeyView, error) {
	rows, err := p.DB.QueryContext(ctx, `SELECT id, provider_code, status FROM provider_keys ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProviderKeyView
	for rows.Next() {
		var r ProviderKeyView
		if err := rows.Scan(&r.ID, &r.ProviderCode, &r.Status); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if out == nil {
		out = []ProviderKeyView{}
	}
	return out, rows.Err()
}

func (p *Postgres) CreateProviderKey(ctx context.Context, in ProviderKeyCreate) (*ProviderKeyView, error) {
	code := strings.TrimSpace(in.ProviderCode)
	if code == "" || strings.TrimSpace(in.Secret) == "" {
		return nil, ErrInvalid
	}
	enc, err := secret.Encrypt(p.EncryptKey, in.Secret)
	if err != nil {
		return nil, err
	}
	var id int64
	if err := p.DB.QueryRowContext(ctx, `
INSERT INTO provider_keys (provider_code, secret_encrypted, status)
VALUES ($1, $2, 'active') RETURNING id
`, code, enc).Scan(&id); err != nil {
		return nil, err
	}
	return &ProviderKeyView{ID: id, ProviderCode: code, Status: StatusActive}, nil
}

func (p *Postgres) UpdateProviderKey(ctx context.Context, id int64, in ProviderKeyUpdate) (*ProviderKeyView, error) {
	if in.Status != nil {
		st, err := NormalizeStatus(*in.Status)
		if err != nil {
			return nil, err
		}
		res, err := p.DB.ExecContext(ctx, `UPDATE provider_keys SET status=$2 WHERE id=$1`, id, st)
		if err != nil {
			return nil, err
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return nil, ErrNotFound
		}
	}
	var r ProviderKeyView
	err := p.DB.QueryRowContext(ctx, `SELECT id, provider_code, status FROM provider_keys WHERE id=$1`, id).Scan(&r.ID, &r.ProviderCode, &r.Status)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &r, err
}

func (p *Postgres) ListPools(ctx context.Context) ([]PoolView, error) {
	rows, err := p.DB.QueryContext(ctx, `SELECT id, name, group_name FROM channel_pools ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PoolView
	for rows.Next() {
		var r PoolView
		if err := rows.Scan(&r.ID, &r.Name, &r.GroupName); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if out == nil {
		out = []PoolView{}
	}
	return out, rows.Err()
}

func (p *Postgres) CreatePool(ctx context.Context, in PoolCreate) (*PoolView, error) {
	name := strings.TrimSpace(in.Name)
	g := NormalizeGroup(in.GroupName)
	if name == "" || g == "" {
		return nil, ErrInvalid
	}
	var id int64
	if err := p.DB.QueryRowContext(ctx, `
INSERT INTO channel_pools (name, group_name) VALUES ($1, $2) RETURNING id
`, name, g).Scan(&id); err != nil {
		return nil, err
	}
	return &PoolView{ID: id, Name: name, GroupName: g}, nil
}

func (p *Postgres) ListChannels(ctx context.Context) ([]ChannelView, error) {
	rows, err := p.DB.QueryContext(ctx, `
SELECT id, pool_id, provider_key_id, protocol, base_url, status FROM channels ORDER BY id
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChannelView
	for rows.Next() {
		var r ChannelView
		if err := rows.Scan(&r.ID, &r.PoolID, &r.ProviderKeyID, &r.Protocol, &r.BaseURL, &r.Status); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if out == nil {
		out = []ChannelView{}
	}
	return out, rows.Err()
}

func (p *Postgres) CreateChannel(ctx context.Context, in ChannelCreate) (*ChannelView, error) {
	proto, err := NormalizeProtocol(in.Protocol)
	if err != nil {
		return nil, err
	}
	if in.PoolID == 0 || in.ProviderKeyID == 0 || strings.TrimSpace(in.BaseURL) == "" {
		return nil, ErrInvalid
	}
	var id int64
	err = p.DB.QueryRowContext(ctx, `
INSERT INTO channels (pool_id, provider_key_id, protocol, base_url, status)
VALUES ($1,$2,$3,$4,'active') RETURNING id
`, in.PoolID, in.ProviderKeyID, proto, strings.TrimSpace(in.BaseURL)).Scan(&id)
	if err != nil {
		return nil, ErrInvalid
	}
	return &ChannelView{
		ID: id, PoolID: in.PoolID, ProviderKeyID: in.ProviderKeyID,
		Protocol: proto, BaseURL: strings.TrimSpace(in.BaseURL), Status: StatusActive,
	}, nil
}

func (p *Postgres) UpdateChannel(ctx context.Context, id int64, in ChannelUpdate) (*ChannelView, error) {
	var r ChannelView
	err := p.DB.QueryRowContext(ctx, `
SELECT id, pool_id, provider_key_id, protocol, base_url, status FROM channels WHERE id=$1
`, id).Scan(&r.ID, &r.PoolID, &r.ProviderKeyID, &r.Protocol, &r.BaseURL, &r.Status)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if in.Status != nil {
		st, err := NormalizeStatus(*in.Status)
		if err != nil {
			return nil, err
		}
		r.Status = st
	}
	if in.BaseURL != nil {
		r.BaseURL = strings.TrimSpace(*in.BaseURL)
	}
	if _, err := p.DB.ExecContext(ctx, `UPDATE channels SET status=$2, base_url=$3 WHERE id=$1`, id, r.Status, r.BaseURL); err != nil {
		return nil, err
	}
	return &r, nil
}

func (p *Postgres) ListVirtualKeys(ctx context.Context, ownerID int64) ([]VirtualKeyView, error) {
	q := `
SELECT id, pool_id, COALESCE(owner_id,0), status, key_prefix FROM virtual_keys
`
	var args []any
	if ownerID > 0 {
		q += ` WHERE owner_id = $1`
		args = append(args, ownerID)
	}
	q += ` ORDER BY id`
	rows, err := p.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VirtualKeyView
	for rows.Next() {
		var r VirtualKeyView
		if err := rows.Scan(&r.ID, &r.PoolID, &r.OwnerID, &r.Status, &r.KeyPrefix); err != nil {
			return nil, err
		}
		r.KeyMasked = MaskPrefix(r.KeyPrefix)
		out = append(out, r)
	}
	if out == nil {
		out = []VirtualKeyView{}
	}
	return out, rows.Err()
}

func (p *Postgres) CreateVirtualKey(ctx context.Context, in VirtualKeyCreate) (*VirtualKeyCreated, error) {
	if in.PoolID == 0 {
		return nil, ErrInvalid
	}
	raw, prefix := GenerateVK()
	var owner any
	if in.OwnerID > 0 {
		owner = in.OwnerID
	}
	var id int64
	err := p.DB.QueryRowContext(ctx, `
INSERT INTO virtual_keys (key_hash, key_prefix, pool_id, status, owner_id)
VALUES ($1,$2,$3,'active',$4) RETURNING id
`, secret.HashVK(raw), prefix, in.PoolID, owner).Scan(&id)
	if err != nil {
		return nil, ErrInvalid
	}
	view := VirtualKeyView{
		ID: id, PoolID: in.PoolID, OwnerID: in.OwnerID,
		Status: StatusActive, KeyPrefix: prefix, KeyMasked: MaskPrefix(prefix),
	}
	return &VirtualKeyCreated{VirtualKeyView: view, Secret: raw}, nil
}

func (p *Postgres) UpdateVirtualKey(ctx context.Context, id int64, in VirtualKeyUpdate) (*VirtualKeyView, error) {
	var r VirtualKeyView
	err := p.DB.QueryRowContext(ctx, `
SELECT id, pool_id, COALESCE(owner_id,0), status, key_prefix FROM virtual_keys WHERE id=$1
`, id).Scan(&r.ID, &r.PoolID, &r.OwnerID, &r.Status, &r.KeyPrefix)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if in.Status != nil {
		st, err := NormalizeStatus(*in.Status)
		if err != nil {
			return nil, err
		}
		r.Status = st
	}
	if in.OwnerID != nil {
		r.OwnerID = *in.OwnerID
	}
	if in.PoolID != nil {
		r.PoolID = *in.PoolID
	}
	var owner any
	if r.OwnerID > 0 {
		owner = r.OwnerID
	}
	if _, err := p.DB.ExecContext(ctx, `
UPDATE virtual_keys SET status=$2, owner_id=$3, pool_id=$4 WHERE id=$1
`, id, r.Status, owner, r.PoolID); err != nil {
		return nil, err
	}
	r.KeyMasked = MaskPrefix(r.KeyPrefix)
	return &r, nil
}
