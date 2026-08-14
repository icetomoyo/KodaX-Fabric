package store

import (
	"context"
	"database/sql"
	"fmt"

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
  role varchar(32) NOT NULL DEFAULT 'admin',
  name varchar(100) NOT NULL DEFAULT '',
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE operators ADD COLUMN IF NOT EXISTS name varchar(100) NOT NULL DEFAULT '';
ALTER TABLE operators ADD COLUMN IF NOT EXISTS status varchar(32) NOT NULL DEFAULT 'active';
ALTER TABLE operators ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE operators ADD COLUMN IF NOT EXISTS team_id bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS teams (
  id bigserial PRIMARY KEY,
  name varchar(100) NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id bigserial PRIMARY KEY,
  team_id bigint NOT NULL DEFAULT 0,
  name varchar(100) NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_pools (
  id bigserial PRIMARY KEY,
  name varchar(100) NOT NULL,
  group_name varchar(32) NOT NULL DEFAULT 'standard',
  team_id bigint NOT NULL DEFAULT 0
);
ALTER TABLE channel_pools ADD COLUMN IF NOT EXISTS team_id bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS provider_keys (
  id bigserial PRIMARY KEY,
  provider_code varchar(64) NOT NULL,
  secret_encrypted text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  team_id bigint NOT NULL DEFAULT 0
);
ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS team_id bigint NOT NULL DEFAULT 0;
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
  status varchar(32) NOT NULL DEFAULT 'active',
  owner_id bigint REFERENCES operators(id)
);
ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS owner_id bigint REFERENCES operators(id);
ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS model_scope text NOT NULL DEFAULT '';
ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS project_id bigint NOT NULL DEFAULT 0;
ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS rpm_limit int NOT NULL DEFAULT 0;
ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS budget_limit int NOT NULL DEFAULT 0;
ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS budget_used int NOT NULL DEFAULT 0;
ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS budget_month varchar(7) NOT NULL DEFAULT '';
ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS ip_allow text NOT NULL DEFAULT '';
ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS rpm_limit int NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS model_aliases (
  protocol varchar(32) NOT NULL,
  model varchar(128) NOT NULL,
  fallback varchar(128) NOT NULL,
  PRIMARY KEY (protocol, model)
);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS weight int NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS models text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS route_decisions (
  id bigserial PRIMARY KEY,
  request_id varchar(64) NOT NULL,
  channel_id bigint,
  reason varchar(32) NOT NULL,
  fallback boolean NOT NULL DEFAULT false,
  pool_group varchar(32) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE route_decisions ADD COLUMN IF NOT EXISTS pool_group varchar(32) NOT NULL DEFAULT '';
`
	_, err := p.DB.ExecContext(ctx, ddl)
	return err
}

func (p *Postgres) ResolveVK(ctx context.Context, rawKey string) (*ResolvedVK, error) {
	hash := secret.HashVK(rawKey)
	var vkID, poolID, projectID, teamID, poolTeam int64
	var rpm, budgetLimit, budgetUsed int
	var status, groupName, budgetMonth, ipAllow string
	var expires sql.NullTime
	var scope string
	err := p.DB.QueryRowContext(ctx, `
SELECT v.id, v.pool_id, v.status, v.expires_at, COALESCE(v.model_scope,''), COALESCE(v.project_id,0),
       COALESCE(p.team_id,0), COALESCE(cp.group_name,'standard'), COALESCE(cp.team_id,0), COALESCE(v.rpm_limit,0),
       COALESCE(v.budget_limit,0), COALESCE(v.budget_used,0), COALESCE(v.budget_month,''), COALESCE(v.ip_allow,'')
FROM virtual_keys v
LEFT JOIN projects p ON p.id = v.project_id
LEFT JOIN channel_pools cp ON cp.id = v.pool_id
WHERE v.key_hash = $1
`, hash).Scan(&vkID, &poolID, &status, &expires, &scope, &projectID, &teamID, &groupName, &poolTeam, &rpm, &budgetLimit, &budgetUsed, &budgetMonth, &ipAllow)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if status != "active" {
		return nil, nil
	}
	if teamID == 0 {
		teamID = poolTeam
	}
	rows, err := p.DB.QueryContext(ctx, `
SELECT c.id, c.protocol, c.base_url, pk.secret_encrypted,
       COALESCE(c.priority,0), COALESCE(c.weight,0), COALESCE(c.models,''),
       c.pool_id, COALESCE(cp.team_id,0), COALESCE(pk.team_id,0), COALESCE(pk.provider_code,'')
FROM channels c
JOIN provider_keys pk ON pk.id = c.provider_key_id
LEFT JOIN channel_pools cp ON cp.id = c.pool_id
WHERE c.pool_id = $1 AND c.status = 'active' AND pk.status = 'active'
ORDER BY c.id
`, poolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &ResolvedVK{
		VirtualKeyID: vkID, PoolID: poolID, ProjectID: projectID, TeamID: teamID,
		PoolGroup: groupName, RPMLimit: rpm, BudgetLimit: budgetLimit, BudgetUsed: budgetUsed, BudgetMonth: budgetMonth,
		ModelScope: parseModelScope(scope), IPAllow: parseCSV(ipAllow),
	}
	if expires.Valid {
		t := expires.Time.UTC()
		out.ExpiresAt = &t
	}
	for rows.Next() {
		var ch Channel
		var enc, models string
		if err := rows.Scan(&ch.ID, &ch.Protocol, &ch.BaseURL, &enc, &ch.Priority, &ch.Weight, &models, &ch.PoolID, &ch.TeamID, &ch.KeyTeamID, &ch.ProviderCode); err != nil {
			return nil, err
		}
		ch.Models = parseModelScope(models)
		plain, err := secret.Decrypt(p.EncryptKey, enc)
		if err != nil {
			return nil, fmt.Errorf("decrypt provider key: %w", err)
		}
		ch.Secret = plain
		out.Channels = append(out.Channels, ch)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out.PoolGroup = NormalizePoolGroup(out.PoolGroup)
	out.Channels = IsolateChannels(out, out.Channels)
	rpmRows, err := p.DB.QueryContext(ctx, `
SELECT COALESCE(pk.provider_code,''), COALESCE(pk.rpm_limit,0)
FROM provider_keys pk
JOIN channels c ON c.provider_key_id = pk.id
WHERE c.pool_id = $1 AND c.status = 'active'
`, poolID)
	if err != nil {
		return nil, err
	}
	defer rpmRows.Close()
	prpm := map[string]int{}
	for rpmRows.Next() {
		var code string
		var lim int
		if err := rpmRows.Scan(&code, &lim); err != nil {
			return nil, err
		}
		if code != "" && lim > 0 {
			prpm[code] = lim
		}
	}
	if err := rpmRows.Err(); err != nil {
		return nil, err
	}
	if len(prpm) > 0 {
		out.ProviderRPM = prpm
	}
	return out, nil
}

func (p *Postgres) ModelAliases(ctx context.Context) (map[string]string, error) {
	rows, err := p.DB.QueryContext(ctx, `SELECT protocol, model, fallback FROM model_aliases`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var proto, model, fb string
		if err := rows.Scan(&proto, &model, &fb); err != nil {
			return nil, err
		}
		out[AliasKey(proto, model)] = fb
	}
	return out, rows.Err()
}

func (p *Postgres) AddVKUsage(ctx context.Context, vkID int64, tokens int, month string) error {
	if tokens <= 0 {
		return nil
	}
	_, err := p.DB.ExecContext(ctx, `
UPDATE virtual_keys
SET budget_used = CASE WHEN budget_month = $3 THEN budget_used + $2 ELSE $2 END,
    budget_month = $3
WHERE id = $1
`, vkID, tokens, month)
	return err
}

func (p *Postgres) SaveRouteDecision(ctx context.Context, d RouteDecision) error {
	_, err := p.DB.ExecContext(ctx, `
INSERT INTO route_decisions (request_id, channel_id, reason, fallback, pool_group)
VALUES ($1,$2,$3,$4,$5)
`, d.RequestID, d.ChannelID, d.Reason, d.Fallback, d.PoolGroup)
	return err
}

func (p *Postgres) DisableProviderKey(ctx context.Context, channelID int64) error {
	_, err := p.DB.ExecContext(ctx, `
UPDATE provider_keys SET status = 'disabled'
WHERE id = (SELECT provider_key_id FROM channels WHERE id = $1)
`, channelID)
	return err
}
