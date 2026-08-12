package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/lib/pq"

	"kodax-fabric/internal/secret"
)

type Postgres struct {
	DB         *sql.DB
	EncryptKey []byte
}

func OpenPostgres(dsn string) (*sql.DB, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func (p *Postgres) Migrate(ctx context.Context) error {
	const ddl = `
CREATE TABLE IF NOT EXISTS operators (
  id bigserial PRIMARY KEY,
  phone varchar(20) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name varchar(100) NOT NULL DEFAULT '',
  role varchar(32) NOT NULL DEFAULT 'admin'
);
CREATE TABLE IF NOT EXISTS channel_pools (
  id bigserial PRIMARY KEY,
  name varchar(100) NOT NULL,
  group_name varchar(32) NOT NULL DEFAULT 'standard'
);
CREATE TABLE IF NOT EXISTS providers (
  id bigserial PRIMARY KEY,
  code varchar(64) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  default_base_url text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS provider_keys (
  id bigserial PRIMARY KEY,
  provider_code varchar(64) NOT NULL,
  label varchar(100) NOT NULL DEFAULT '',
  secret_encrypted text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS channels (
  id bigserial PRIMARY KEY,
  pool_id bigint NOT NULL REFERENCES channel_pools(id),
  provider_key_id bigint NOT NULL REFERENCES provider_keys(id),
  protocol varchar(32) NOT NULL,
  base_url text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  priority int NOT NULL DEFAULT 0,
  weight int NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS virtual_keys (
  id bigserial PRIMARY KEY,
  key_hash varchar(64) NOT NULL UNIQUE,
  key_prefix varchar(16) NOT NULL,
  name varchar(100) NOT NULL DEFAULT '',
  pool_id bigint NOT NULL REFERENCES channel_pools(id),
  owner_id bigint,
  status varchar(32) NOT NULL DEFAULT 'active',
  rpm_limit int NOT NULL DEFAULT 0,
  monthly_token_limit bigint NOT NULL DEFAULT 0,
  monthly_tokens_used bigint NOT NULL DEFAULT 0,
  usage_month varchar(7) NOT NULL DEFAULT '',
  expires_at timestamptz,
  model_scope text NOT NULL DEFAULT '',
  ip_whitelist text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS vk_applications (
  id bigserial PRIMARY KEY,
  operator_id bigint NOT NULL REFERENCES operators(id),
  pool_id bigint NOT NULL REFERENCES channel_pools(id),
  name varchar(100) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  created_vk_prefix varchar(16),
  raw_key_once text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`
	if _, err := p.DB.ExecContext(ctx, ddl); err != nil {
		return err
	}
	alters := []string{
		`ALTER TABLE operators ADD COLUMN IF NOT EXISTS name varchar(100) NOT NULL DEFAULT ''`,
		`ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS label varchar(100) NOT NULL DEFAULT ''`,
		`ALTER TABLE channels ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 0`,
		`ALTER TABLE channels ADD COLUMN IF NOT EXISTS weight int NOT NULL DEFAULT 100`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS name varchar(100) NOT NULL DEFAULT ''`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS owner_id bigint`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS rpm_limit int NOT NULL DEFAULT 0`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS monthly_token_limit bigint NOT NULL DEFAULT 0`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS monthly_tokens_used bigint NOT NULL DEFAULT 0`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS usage_month varchar(7) NOT NULL DEFAULT ''`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS model_scope text NOT NULL DEFAULT ''`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS ip_whitelist text NOT NULL DEFAULT ''`,
	}
	for _, q := range alters {
		if _, err := p.DB.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	return nil
}

func (p *Postgres) ResolveVK(ctx context.Context, rawKey string) (*ResolvedVK, error) {
	hash := secret.HashVK(rawKey)
	var vk ResolvedVK
	var status, month, models, ips string
	var expires sql.NullTime
	err := p.DB.QueryRowContext(ctx, `
SELECT id, pool_id, name, status, rpm_limit, monthly_token_limit, monthly_tokens_used,
       usage_month, expires_at, model_scope, ip_whitelist
FROM virtual_keys WHERE key_hash = $1
`, hash).Scan(&vk.VirtualKeyID, &vk.PoolID, &vk.Name, &status, &vk.RPMLimit,
		&vk.MonthlyTokenLimit, &vk.MonthlyTokensUsed, &month, &expires, &models, &ips)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if status != "active" {
		return nil, nil
	}
	if expires.Valid {
		t := expires.Time
		vk.ExpiresAt = &t
	}
	vk.ModelScope = splitCSV(models)
	vk.IPWhitelist = splitCSV(ips)
	cur := time.Now().UTC().Format("2006-01")
	if month != cur {
		vk.MonthlyTokensUsed = 0
		_, _ = p.DB.ExecContext(ctx, `UPDATE virtual_keys SET monthly_tokens_used=0, usage_month=$1 WHERE id=$2`, cur, vk.VirtualKeyID)
	}
	rows, err := p.DB.QueryContext(ctx, `
SELECT c.id, c.pool_id, c.protocol, c.base_url, pk.secret_encrypted, c.priority, c.weight, c.status
FROM channels c
JOIN provider_keys pk ON pk.id = c.provider_key_id
WHERE c.pool_id = $1 AND pk.status = 'active'
ORDER BY c.priority DESC, c.weight DESC, c.id
`, vk.PoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var ch Channel
		var enc string
		if err := rows.Scan(&ch.ID, &ch.PoolID, &ch.Protocol, &ch.BaseURL, &enc, &ch.Priority, &ch.Weight, &ch.Status); err != nil {
			return nil, err
		}
		plain, err := secret.Decrypt(p.EncryptKey, enc)
		if err != nil {
			return nil, fmt.Errorf("decrypt provider key: %w", err)
		}
		ch.Secret = plain
		vk.Channels = append(vk.Channels, ch)
	}
	return &vk, rows.Err()
}

func (p *Postgres) AddUsage(ctx context.Context, vkID int64, tokens int64) error {
	cur := time.Now().UTC().Format("2006-01")
	_, err := p.DB.ExecContext(ctx, `
UPDATE virtual_keys
SET monthly_tokens_used = CASE WHEN usage_month = $2 THEN monthly_tokens_used + $3 ELSE $3 END,
    usage_month = $2
WHERE id = $1
`, vkID, cur, tokens)
	return err
}

func splitCSV(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func JoinCSV(ss []string) string {
	return strings.Join(ss, ",")
}
