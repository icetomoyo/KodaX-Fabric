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
  status varchar(32) NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  model_scope text NOT NULL DEFAULT ''
);
`
	if _, err := p.DB.ExecContext(ctx, ddl); err != nil {
		return err
	}
	for _, q := range []string{
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS model_scope text NOT NULL DEFAULT ''`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS rpm_limit int NOT NULL DEFAULT 0`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS rpm_burst int NOT NULL DEFAULT 0`,
		`ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS rpm_limit int NOT NULL DEFAULT 0`,
		`ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS rpm_burst int NOT NULL DEFAULT 0`,
		`ALTER TABLE channels ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 0`,
		`ALTER TABLE channels ADD COLUMN IF NOT EXISTS weight int NOT NULL DEFAULT 100`,
		`ALTER TABLE channels ADD COLUMN IF NOT EXISTS models text NOT NULL DEFAULT ''`,
		`CREATE TABLE IF NOT EXISTS model_aliases (
  alias varchar(128) PRIMARY KEY,
  targets text NOT NULL
)`,
		`CREATE TABLE IF NOT EXISTS teams (
  id bigserial PRIMARY KEY,
  name varchar(100) NOT NULL UNIQUE
)`,
		`CREATE TABLE IF NOT EXISTS projects (
  id bigserial PRIMARY KEY,
  team_id bigint NOT NULL REFERENCES teams(id),
  name varchar(100) NOT NULL
)`,
		`ALTER TABLE channel_pools ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES teams(id)`,
		`ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES teams(id)`,
		`ALTER TABLE virtual_keys ADD COLUMN IF NOT EXISTS project_id bigint REFERENCES projects(id)`,
		`CREATE TABLE IF NOT EXISTS route_decisions (
  id bigserial PRIMARY KEY,
  virtual_key_id bigint,
  protocol varchar(32) NOT NULL DEFAULT '',
  requested_model text NOT NULL DEFAULT '',
  upstream_model text NOT NULL DEFAULT '',
  channel_id bigint,
  tried_ids text NOT NULL DEFAULT '',
  reason varchar(32) NOT NULL DEFAULT '',
  fallback boolean NOT NULL DEFAULT false,
  status int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  team_id bigint,
  pool_id bigint,
  pool_group varchar(32) NOT NULL DEFAULT ''
)`,
		`ALTER TABLE route_decisions ADD COLUMN IF NOT EXISTS team_id bigint`,
		`ALTER TABLE route_decisions ADD COLUMN IF NOT EXISTS pool_id bigint`,
		`ALTER TABLE route_decisions ADD COLUMN IF NOT EXISTS pool_group varchar(32) NOT NULL DEFAULT ''`,
	} {
		if _, err := p.DB.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	return nil
}

func (p *Postgres) ResolveVK(ctx context.Context, rawKey string) (*ResolvedVK, error) {
	hash := secret.HashVK(rawKey)
	var vkID, poolID int64
	var status, models string
	var rpm, burst int
	var expires sql.NullTime
	var projectID, teamID, poolTeam sql.NullInt64
	var projectName, teamName, poolName, poolGroup sql.NullString
	err := p.DB.QueryRowContext(ctx, `
SELECT vk.id, vk.pool_id, vk.status, vk.expires_at, vk.model_scope,
       vk.rpm_limit, vk.rpm_burst,
       vk.project_id, pr.name, pr.team_id, t.name,
       p.name, p.group_name, p.team_id
FROM virtual_keys vk
LEFT JOIN projects pr ON pr.id = vk.project_id
LEFT JOIN teams t ON t.id = pr.team_id
LEFT JOIN channel_pools p ON p.id = vk.pool_id
WHERE vk.key_hash = $1
`, hash).Scan(&vkID, &poolID, &status, &expires, &models, &rpm, &burst,
		&projectID, &projectName, &teamID, &teamName,
		&poolName, &poolGroup, &poolTeam)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if status != "active" {
		return nil, nil
	}
	if teamID.Valid && poolTeam.Valid && teamID.Int64 != poolTeam.Int64 {
		return &ResolvedVK{
			VirtualKeyID: vkID, PoolID: poolID, PoolName: poolName.String, PoolGroup: poolGroup.String,
			TeamID: teamID.Int64, TeamName: teamName.String, ProjectID: projectID.Int64, ProjectName: projectName.String,
			ModelScope: splitCSV(models), RPMLimit: rpm, RPMBurst: burst,
		}, nil
	}
	const chSelect = `
SELECT c.id, c.protocol, c.base_url, pk.secret_encrypted, c.priority, c.weight, c.models,
       c.pool_id, COALESCE(p.team_id, 0), COALESCE(pk.team_id, 0),
       pk.provider_code, pk.rpm_limit, pk.rpm_burst
FROM channels c
JOIN provider_keys pk ON pk.id = c.provider_key_id
JOIN channel_pools p ON p.id = c.pool_id
WHERE c.pool_id = $1 AND c.status = 'active' AND pk.status = 'active'`
	const ownerlessFilter = `
  AND COALESCE(p.team_id, 0) = 0 AND COALESCE(pk.team_id, 0) = 0`
	const teamedFilter = `
  AND COALESCE(p.team_id, 0) = $2 AND COALESCE(pk.team_id, 0) = $2`
	const chOrder = `
ORDER BY CASE WHEN c.priority <= 0 THEN 1000000 ELSE c.priority END, c.id`
	var rows *sql.Rows
	if teamID.Int64 == 0 {
		rows, err = p.DB.QueryContext(ctx, chSelect+ownerlessFilter+chOrder, poolID)
	} else {
		rows, err = p.DB.QueryContext(ctx, chSelect+teamedFilter+chOrder, poolID, teamID.Int64)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &ResolvedVK{
		VirtualKeyID: vkID, PoolID: poolID, PoolName: poolName.String, PoolGroup: poolGroup.String,
		TeamID: teamID.Int64, TeamName: teamName.String, ProjectID: projectID.Int64, ProjectName: projectName.String,
		ModelScope: splitCSV(models), RPMLimit: rpm, RPMBurst: burst,
	}
	if expires.Valid {
		t := expires.Time
		out.ExpiresAt = &t
	}
	for rows.Next() {
		var ch Channel
		var enc, modelsCSV string
		if err := rows.Scan(&ch.ID, &ch.Protocol, &ch.BaseURL, &enc, &ch.Priority, &ch.Weight, &modelsCSV,
			&ch.PoolID, &ch.TeamID, &ch.KeyTeamID, &ch.ProviderCode, &ch.ProviderRPM, &ch.ProviderBurst); err != nil {
			return nil, err
		}
		plain, err := secret.Decrypt(p.EncryptKey, enc)
		if err != nil {
			return nil, fmt.Errorf("decrypt provider key: %w", err)
		}
		ch.Secret = plain
		ch.Models = splitCSV(modelsCSV)
		out.Channels = append(out.Channels, ch)
	}
	return IsolateChannels(out), rows.Err()
}

func (p *Postgres) DisableProviderKey(ctx context.Context, channelID int64) error {
	_, err := p.DB.ExecContext(ctx, `
UPDATE provider_keys SET status = 'disabled'
WHERE id = (SELECT provider_key_id FROM channels WHERE id = $1)
`, channelID)
	return err
}

func (p *Postgres) LookupAlias(ctx context.Context, model string) ([]string, error) {
	if model == "" {
		return nil, nil
	}
	var targets string
	err := p.DB.QueryRowContext(ctx, `SELECT targets FROM model_aliases WHERE alias = $1`, model).Scan(&targets)
	if err == sql.ErrNoRows {
		return []string{model}, nil
	}
	if err != nil {
		return nil, err
	}
	out := splitCSV(targets)
	if len(out) == 0 {
		return []string{model}, nil
	}
	return out, nil
}

func (p *Postgres) RecordRoute(ctx context.Context, d RouteDecision) error {
	tried := make([]string, 0, len(d.Tried))
	for _, id := range d.Tried {
		tried = append(tried, fmt.Sprintf("%d", id))
	}
	_, err := p.DB.ExecContext(ctx, `
INSERT INTO route_decisions (
  virtual_key_id, protocol, requested_model, upstream_model,
  channel_id, tried_ids, reason, fallback, status, created_at,
  team_id, pool_id, pool_group
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, now()),$11,$12,$13)
`, d.VirtualKeyID, d.Protocol, d.RequestedModel, d.UpstreamModel,
		d.ChannelID, strings.Join(tried, ","), d.Reason, d.Fallback, d.Status, nullTime(d.At),
		d.TeamID, d.PoolID, d.PoolGroup)
	return err
}

func (p *Postgres) RecentRoutes(ctx context.Context, vkID int64) ([]RouteDecision, error) {
	rows, err := p.DB.QueryContext(ctx, `
SELECT virtual_key_id, protocol, requested_model, upstream_model, channel_id,
       tried_ids, reason, fallback, status, created_at,
       COALESCE(team_id, 0), COALESCE(pool_id, 0), COALESCE(pool_group, '')
FROM route_decisions
WHERE ($1 = 0 OR virtual_key_id = $1)
ORDER BY id
`, vkID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RouteDecision
	for rows.Next() {
		var d RouteDecision
		var tried string
		var at time.Time
		if err := rows.Scan(&d.VirtualKeyID, &d.Protocol, &d.RequestedModel, &d.UpstreamModel,
			&d.ChannelID, &tried, &d.Reason, &d.Fallback, &d.Status, &at,
			&d.TeamID, &d.PoolID, &d.PoolGroup); err != nil {
			return nil, err
		}
		d.Tried = parseIDs(tried)
		d.At = at
		out = append(out, d)
	}
	return out, rows.Err()
}

func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

func parseIDs(s string) []int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	var out []int64
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		var id int64
		if _, err := fmt.Sscanf(p, "%d", &id); err == nil && id != 0 {
			out = append(out, id)
		}
	}
	return out
}

func splitCSV(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
