package admin

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"

	"kodax-fabric/internal/secret"
)

type Catalog struct {
	DB         *sql.DB
	EncryptKey []byte
}

type Operator struct {
	ID           int64
	Phone        string
	Name         string
	Role         string
	PasswordHash string
}

func (c *Catalog) FindOperator(ctx context.Context, phone string) (*Operator, error) {
	var o Operator
	err := c.DB.QueryRowContext(ctx, `SELECT id, phone, name, role, password_hash FROM operators WHERE phone=$1`, phone).
		Scan(&o.ID, &o.Phone, &o.Name, &o.Role, &o.PasswordHash)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &o, err
}

func (c *Catalog) CreateOperator(ctx context.Context, phone, name, role, password string) (*Operator, error) {
	h, err := hashPassword(password)
	if err != nil {
		return nil, err
	}
	var id int64
	err = c.DB.QueryRowContext(ctx, `
INSERT INTO operators (phone, name, role, password_hash) VALUES ($1,$2,$3,$4)
ON CONFLICT (phone) DO UPDATE SET name=EXCLUDED.name
RETURNING id
`, phone, name, role, h).Scan(&id)
	if err != nil {
		return nil, err
	}
	return &Operator{ID: id, Phone: phone, Name: name, Role: role}, nil
}

func (c *Catalog) ListProviders(ctx context.Context) ([]map[string]any, error) {
	rows, err := c.DB.QueryContext(ctx, `SELECT id, code, name, default_base_url FROM providers ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMaps(rows, "id", "code", "name", "default_base_url")
}

func (c *Catalog) CreateProvider(ctx context.Context, code, name, base string) (int64, error) {
	var id int64
	err := c.DB.QueryRowContext(ctx, `
INSERT INTO providers (code, name, default_base_url) VALUES ($1,$2,$3)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, default_base_url=EXCLUDED.default_base_url
RETURNING id`, code, name, base).Scan(&id)
	return id, err
}

func (c *Catalog) ListProviderKeys(ctx context.Context) ([]map[string]any, error) {
	rows, err := c.DB.QueryContext(ctx, `SELECT id, provider_code, label, status FROM provider_keys ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMaps(rows, "id", "provider_code", "label", "status")
}

func (c *Catalog) CreateProviderKey(ctx context.Context, code, label, raw, status string) (int64, error) {
	enc, err := secret.Encrypt(c.EncryptKey, raw)
	if err != nil {
		return 0, err
	}
	if status == "" {
		status = "active"
	}
	var id int64
	err = c.DB.QueryRowContext(ctx, `
INSERT INTO provider_keys (provider_code, label, secret_encrypted, status) VALUES ($1,$2,$3,$4) RETURNING id
`, code, label, enc, status).Scan(&id)
	return id, err
}

func (c *Catalog) UpdateProviderKeyStatus(ctx context.Context, id int64, status string) error {
	_, err := c.DB.ExecContext(ctx, `UPDATE provider_keys SET status=$2 WHERE id=$1`, id, status)
	return err
}

func (c *Catalog) ListPools(ctx context.Context) ([]map[string]any, error) {
	rows, err := c.DB.QueryContext(ctx, `SELECT id, name, group_name FROM channel_pools ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMaps(rows, "id", "name", "group_name")
}

func (c *Catalog) CreatePool(ctx context.Context, name, group string) (int64, error) {
	if group == "" {
		group = "standard"
	}
	var id int64
	err := c.DB.QueryRowContext(ctx, `INSERT INTO channel_pools (name, group_name) VALUES ($1,$2) RETURNING id`, name, group).Scan(&id)
	return id, err
}

func (c *Catalog) ListChannels(ctx context.Context) ([]map[string]any, error) {
	rows, err := c.DB.QueryContext(ctx, `
SELECT c.id, c.pool_id, c.provider_key_id, c.protocol, c.base_url, c.status, c.priority, c.weight, pk.provider_code, pk.label
FROM channels c JOIN provider_keys pk ON pk.id=c.provider_key_id ORDER BY c.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMaps(rows, "id", "pool_id", "provider_key_id", "protocol", "base_url", "status", "priority", "weight", "provider_code", "label")
}

func (c *Catalog) CreateChannel(ctx context.Context, poolID, keyID int64, protocol, base, status string, pri, weight int) (int64, error) {
	if status == "" {
		status = "active"
	}
	if weight == 0 {
		weight = 100
	}
	var id int64
	err := c.DB.QueryRowContext(ctx, `
INSERT INTO channels (pool_id, provider_key_id, protocol, base_url, status, priority, weight)
VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, poolID, keyID, protocol, base, status, pri, weight).Scan(&id)
	return id, err
}

func (c *Catalog) UpdateChannel(ctx context.Context, id int64, status string, pri, weight int) error {
	_, err := c.DB.ExecContext(ctx, `UPDATE channels SET status=$2, priority=$3, weight=$4 WHERE id=$1`, id, status, pri, weight)
	return err
}

func (c *Catalog) ListVKs(ctx context.Context) ([]map[string]any, error) {
	rows, err := c.DB.QueryContext(ctx, `
SELECT id, key_prefix, name, pool_id, status, rpm_limit, monthly_token_limit, monthly_tokens_used, expires_at, model_scope, ip_whitelist
FROM virtual_keys ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMaps(rows, "id", "key_prefix", "name", "pool_id", "status", "rpm_limit", "monthly_token_limit", "monthly_tokens_used", "expires_at", "model_scope", "ip_whitelist")
}

func (c *Catalog) CreateVK(ctx context.Context, name string, poolID, ownerID int64, rpm int, budget int64, models, ips string) (int64, string, error) {
	raw := "fab-" + randomHex(16)
	prefix := raw
	if len(prefix) > 12 {
		prefix = prefix[:12]
	}
	var owner any
	if ownerID > 0 {
		owner = ownerID
	}
	var id int64
	err := c.DB.QueryRowContext(ctx, `
INSERT INTO virtual_keys (key_hash, key_prefix, name, pool_id, owner_id, status, rpm_limit, monthly_token_limit, model_scope, ip_whitelist)
VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9) RETURNING id
`, secret.HashVK(raw), prefix, name, poolID, owner, rpm, budget, models, ips).Scan(&id)
	return id, raw, err
}

func (c *Catalog) RevokeVK(ctx context.Context, id int64) error {
	_, err := c.DB.ExecContext(ctx, `UPDATE virtual_keys SET status='revoked' WHERE id=$1`, id)
	return err
}

func (c *Catalog) CreateApplication(ctx context.Context, opID, poolID int64, name string) (int64, error) {
	var id int64
	err := c.DB.QueryRowContext(ctx, `
INSERT INTO vk_applications (operator_id, pool_id, name, status) VALUES ($1,$2,$3,'pending') RETURNING id
`, opID, poolID, name).Scan(&id)
	return id, err
}

func (c *Catalog) ListApplications(ctx context.Context, onlyOp int64) ([]map[string]any, error) {
	q := `SELECT id, operator_id, pool_id, name, status, created_vk_prefix, created_at FROM vk_applications`
	args := []any{}
	if onlyOp > 0 {
		q += ` WHERE operator_id=$1`
		args = append(args, onlyOp)
	}
	q += ` ORDER BY id DESC`
	rows, err := c.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMaps(rows, "id", "operator_id", "pool_id", "name", "status", "created_vk_prefix", "created_at")
}

func (c *Catalog) ApproveApplication(ctx context.Context, appID int64) (string, error) {
	var opID, poolID int64
	var name, status string
	err := c.DB.QueryRowContext(ctx, `SELECT operator_id, pool_id, name, status FROM vk_applications WHERE id=$1`, appID).
		Scan(&opID, &poolID, &name, &status)
	if err != nil {
		return "", err
	}
	if status != "pending" {
		return "", fmt.Errorf("application not pending")
	}
	id, raw, err := c.CreateVK(ctx, name, poolID, opID, 60, 0, "", "")
	if err != nil {
		return "", err
	}
	prefix := raw
	if len(prefix) > 12 {
		prefix = prefix[:12]
	}
	_, err = c.DB.ExecContext(ctx, `UPDATE vk_applications SET status='approved', created_vk_prefix=$2, raw_key_once=$3 WHERE id=$1`, appID, prefix, raw)
	_ = id
	return raw, err
}

func (c *Catalog) TakeApplicationKey(ctx context.Context, appID, opID int64) (string, error) {
	var raw sql.NullString
	var owner int64
	err := c.DB.QueryRowContext(ctx, `SELECT operator_id, raw_key_once FROM vk_applications WHERE id=$1`, appID).Scan(&owner, &raw)
	if err != nil {
		return "", err
	}
	if owner != opID {
		return "", fmt.Errorf("forbidden")
	}
	if !raw.Valid || raw.String == "" {
		return "", fmt.Errorf("key already revealed")
	}
	_, _ = c.DB.ExecContext(ctx, `UPDATE vk_applications SET raw_key_once='' WHERE id=$1`, appID)
	return raw.String, nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func scanMaps(rows *sql.Rows, cols ...string) ([]map[string]any, error) {
	var out []map[string]any
	dest := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range dest {
		ptrs[i] = &dest[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := map[string]any{}
		for i, c := range cols {
			v := dest[i]
			switch t := v.(type) {
			case []byte:
				m[c] = string(t)
			default:
				m[c] = t
			}
		}
		out = append(out, m)
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out, rows.Err()
}
