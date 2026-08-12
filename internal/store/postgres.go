package store

import (
	"context"
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"

	"kodax-fabric/internal/secret"
)

type Postgres struct {
	DB        *sql.DB
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
  role varchar(32) NOT NULL DEFAULT 'admin'
);
CREATE TABLE IF NOT EXISTS channel_pools (
  id bigserial PRIMARY KEY,
  name varchar(100) NOT NULL,
  group_name varchar(32) NOT NULL DEFAULT 'standard'
);
CREATE TABLE IF NOT EXISTS provider_keys (
  id bigserial PRIMARY KEY,
  provider_code varchar(64) NOT NULL,
  secret_encrypted text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS channels (
  id bigserial PRIMARY KEY,
  pool_id bigint NOT NULL REFERENCES channel_pools(id),
  provider_key_id bigint NOT NULL REFERENCES provider_keys(id),
  protocol varchar(32) NOT NULL,
  base_url text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS virtual_keys (
  id bigserial PRIMARY KEY,
  key_hash varchar(64) NOT NULL UNIQUE,
  key_prefix varchar(16) NOT NULL,
  pool_id bigint NOT NULL REFERENCES channel_pools(id),
  status varchar(32) NOT NULL DEFAULT 'active'
);
`
	_, err := p.DB.ExecContext(ctx, ddl)
	return err
}

func (p *Postgres) ResolveVK(ctx context.Context, rawKey string) (*ResolvedVK, error) {
	hash := secret.HashVK(rawKey)
	var vkID, poolID int64
	var status string
	err := p.DB.QueryRowContext(ctx, `
SELECT id, pool_id, status FROM virtual_keys WHERE key_hash = $1
`, hash).Scan(&vkID, &poolID, &status)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if status != "active" {
		return nil, nil
	}
	rows, err := p.DB.QueryContext(ctx, `
SELECT c.id, c.protocol, c.base_url, pk.secret_encrypted
FROM channels c
JOIN provider_keys pk ON pk.id = c.provider_key_id
WHERE c.pool_id = $1 AND c.status = 'active' AND pk.status = 'active'
ORDER BY c.id
`, poolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &ResolvedVK{VirtualKeyID: vkID, PoolID: poolID}
	for rows.Next() {
		var ch Channel
		var enc string
		if err := rows.Scan(&ch.ID, &ch.Protocol, &ch.BaseURL, &enc); err != nil {
			return nil, err
		}
		plain, err := secret.Decrypt(p.EncryptKey, enc)
		if err != nil {
			return nil, fmt.Errorf("decrypt provider key: %w", err)
		}
		ch.Secret = plain
		out.Channels = append(out.Channels, ch)
	}
	return out, rows.Err()
}
