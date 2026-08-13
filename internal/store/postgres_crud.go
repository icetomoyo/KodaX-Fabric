package store

import (
	"context"
	"database/sql"

	"kodax-fabric/internal/secret"
)

func (p *Postgres) ListProviders(ctx context.Context) ([]ProviderKeyView, error) {
	return p.ListProviderKeys(ctx)
}

func (p *Postgres) teamExists(ctx context.Context, id int64) error {
	if id == 0 {
		return nil
	}
	var n int
	if err := p.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM teams WHERE id=$1`, id).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return badRequest("unknown team")
	}
	return nil
}

func (p *Postgres) poolMeta(ctx context.Context, id int64) (teamID int64, err error) {
	var team sql.NullInt64
	err = p.DB.QueryRowContext(ctx, `SELECT team_id FROM channel_pools WHERE id=$1`, id).Scan(&team)
	if err == sql.ErrNoRows {
		return 0, badRequest("unknown pool")
	}
	if err != nil {
		return 0, err
	}
	return team.Int64, nil
}

func (p *Postgres) providerMeta(ctx context.Context, id int64) (teamID int64, err error) {
	var team sql.NullInt64
	err = p.DB.QueryRowContext(ctx, `SELECT team_id FROM provider_keys WHERE id=$1`, id).Scan(&team)
	if err == sql.ErrNoRows {
		return 0, badRequest("unknown provider")
	}
	if err != nil {
		return 0, err
	}
	return team.Int64, nil
}

func (p *Postgres) projectTeam(ctx context.Context, id int64) (int64, error) {
	if id == 0 {
		return 0, nil
	}
	var team int64
	err := p.DB.QueryRowContext(ctx, `SELECT team_id FROM projects WHERE id=$1`, id).Scan(&team)
	if err == sql.ErrNoRows {
		return 0, badRequest("unknown project")
	}
	if err != nil {
		return 0, err
	}
	return team, nil
}

func (p *Postgres) getProviderRow(ctx context.Context, id int64) (*ProviderWrite, error) {
	var in ProviderWrite
	var team sql.NullInt64
	err := p.DB.QueryRowContext(ctx, `
SELECT provider_code, status, rpm_limit, rpm_burst, team_id
FROM provider_keys WHERE id=$1`, id).Scan(&in.ProviderCode, &in.Status, &in.RPMLimit, &in.RPMBurst, &team)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	in.TeamID = team.Int64
	return &in, nil
}

func (p *Postgres) providerViewByID(ctx context.Context, id int64) (*ProviderKeyView, error) {
	var v ProviderKeyView
	var act, ret sql.NullTime
	err := p.DB.QueryRowContext(ctx, `
SELECT id, provider_code, status, COALESCE(team_id,0), rpm_limit, rpm_burst,
       COALESCE(replacement_encrypted, '') <> '', replacement_activate_at, retire_at
FROM provider_keys WHERE id=$1`, id).Scan(
		&v.ID, &v.ProviderCode, &v.Status, &v.TeamID, &v.RPMLimit, &v.RPMBurst,
		&v.HasReplacement, &act, &ret)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if act.Valid {
		t := act.Time
		v.ActivateAt = &t
	}
	if ret.Valid {
		t := ret.Time
		v.RetireAt = &t
	}
	return &v, nil
}

func (p *Postgres) CreateProvider(ctx context.Context, in ProviderWrite) (*ProviderKeyView, error) {
	if err := validateProviderWrite(&in); err != nil {
		return nil, err
	}
	if err := p.teamExists(ctx, in.TeamID); err != nil {
		return nil, err
	}
	enc, err := secret.Encrypt(p.EncryptKey, in.Secret)
	if err != nil {
		return nil, err
	}
	var id int64
	err = p.DB.QueryRowContext(ctx, `
INSERT INTO provider_keys (provider_code, secret_encrypted, status, rpm_limit, rpm_burst, team_id)
VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
`, in.ProviderCode, enc, in.Status, in.RPMLimit, in.RPMBurst, nullInt(in.TeamID)).Scan(&id)
	if err != nil {
		return nil, err
	}
	return p.providerViewByID(ctx, id)
}

func (p *Postgres) UpdateProvider(ctx context.Context, id int64, in ProviderPatch) (*ProviderKeyView, error) {
	cur, err := p.getProviderRow(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := applyProviderPatch(cur, in); err != nil {
		return nil, err
	}
	if err := p.teamExists(ctx, cur.TeamID); err != nil {
		return nil, err
	}
	if in.Secret != nil {
		enc, err := secret.Encrypt(p.EncryptKey, cur.Secret)
		if err != nil {
			return nil, err
		}
		_, err = p.DB.ExecContext(ctx, `
UPDATE provider_keys SET provider_code=$2, status=$3, rpm_limit=$4, rpm_burst=$5, team_id=$6, secret_encrypted=$7 WHERE id=$1
`, id, cur.ProviderCode, cur.Status, cur.RPMLimit, cur.RPMBurst, nullInt(cur.TeamID), enc)
		if err != nil {
			return nil, err
		}
	} else {
		_, err = p.DB.ExecContext(ctx, `
UPDATE provider_keys SET provider_code=$2, status=$3, rpm_limit=$4, rpm_burst=$5, team_id=$6 WHERE id=$1
`, id, cur.ProviderCode, cur.Status, cur.RPMLimit, cur.RPMBurst, nullInt(cur.TeamID))
		if err != nil {
			return nil, err
		}
	}
	return p.providerViewByID(ctx, id)
}

func (p *Postgres) DisableProvider(ctx context.Context, id int64) error {
	res, err := p.DB.ExecContext(ctx, `UPDATE provider_keys SET status='disabled' WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) ListPools(ctx context.Context) ([]ChannelPool, error) {
	rows, err := p.DB.QueryContext(ctx, `SELECT id, name, group_name, COALESCE(team_id,0) FROM channel_pools ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChannelPool
	for rows.Next() {
		var c ChannelPool
		if err := rows.Scan(&c.ID, &c.Name, &c.GroupName, &c.TeamID); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (p *Postgres) CreatePool(ctx context.Context, in ChannelPool) (*ChannelPool, error) {
	if err := validatePoolWrite(&in); err != nil {
		return nil, err
	}
	if err := p.teamExists(ctx, in.TeamID); err != nil {
		return nil, err
	}
	err := p.DB.QueryRowContext(ctx, `
INSERT INTO channel_pools (name, group_name, team_id) VALUES ($1,$2,$3) RETURNING id
`, in.Name, in.GroupName, nullInt(in.TeamID)).Scan(&in.ID)
	if err != nil {
		return nil, err
	}
	return &in, nil
}

func (p *Postgres) UpdatePool(ctx context.Context, id int64, in PoolPatch) (*ChannelPool, error) {
	var cur ChannelPool
	err := p.DB.QueryRowContext(ctx, `SELECT id, name, group_name, COALESCE(team_id,0) FROM channel_pools WHERE id=$1`, id).Scan(&cur.ID, &cur.Name, &cur.GroupName, &cur.TeamID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := applyPoolPatch(&cur, in); err != nil {
		return nil, err
	}
	if err := p.teamExists(ctx, cur.TeamID); err != nil {
		return nil, err
	}
	_, err = p.DB.ExecContext(ctx, `UPDATE channel_pools SET name=$2, group_name=$3, team_id=$4 WHERE id=$1`, id, cur.Name, cur.GroupName, nullInt(cur.TeamID))
	if err != nil {
		return nil, err
	}
	return &cur, nil
}

func (p *Postgres) ListChannelsAdmin(ctx context.Context) ([]ChannelAdmin, error) {
	rows, err := p.DB.QueryContext(ctx, `
SELECT id, pool_id, provider_key_id, protocol, base_url, status, priority, weight, models
FROM channels ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChannelAdmin
	for rows.Next() {
		var c ChannelAdmin
		var models string
		if err := rows.Scan(&c.ID, &c.PoolID, &c.ProviderKeyID, &c.Protocol, &c.BaseURL, &c.Status, &c.Priority, &c.Weight, &models); err != nil {
			return nil, err
		}
		c.Models = splitCSV(models)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (p *Postgres) checkChannelRefs(ctx context.Context, poolID, keyID int64) error {
	poolTeam, err := p.poolMeta(ctx, poolID)
	if err != nil {
		return err
	}
	keyTeam, err := p.providerMeta(ctx, keyID)
	if err != nil {
		return err
	}
	return ValidateTeamMatch(poolTeam, keyTeam)
}

func (p *Postgres) CreateChannel(ctx context.Context, in ChannelAdmin) (*ChannelAdmin, error) {
	if err := validateChannelWrite(&in); err != nil {
		return nil, err
	}
	if err := p.checkChannelRefs(ctx, in.PoolID, in.ProviderKeyID); err != nil {
		return nil, err
	}
	err := p.DB.QueryRowContext(ctx, `
INSERT INTO channels (pool_id, provider_key_id, protocol, base_url, status, priority, weight, models)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
`, in.PoolID, in.ProviderKeyID, in.Protocol, in.BaseURL, in.Status, in.Priority, in.Weight, joinCSV(in.Models)).Scan(&in.ID)
	if err != nil {
		return nil, err
	}
	return &in, nil
}

func (p *Postgres) UpdateChannel(ctx context.Context, id int64, in ChannelPatch) (*ChannelAdmin, error) {
	var cur ChannelAdmin
	var models string
	err := p.DB.QueryRowContext(ctx, `
SELECT id, pool_id, provider_key_id, protocol, base_url, status, priority, weight, models
FROM channels WHERE id=$1`, id).Scan(&cur.ID, &cur.PoolID, &cur.ProviderKeyID, &cur.Protocol, &cur.BaseURL, &cur.Status, &cur.Priority, &cur.Weight, &models)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	cur.Models = splitCSV(models)
	if err := applyChannelPatch(&cur, in); err != nil {
		return nil, err
	}
	if err := p.checkChannelRefs(ctx, cur.PoolID, cur.ProviderKeyID); err != nil {
		return nil, err
	}
	_, err = p.DB.ExecContext(ctx, `
UPDATE channels SET pool_id=$2, provider_key_id=$3, protocol=$4, base_url=$5, status=$6, priority=$7, weight=$8, models=$9 WHERE id=$1
`, id, cur.PoolID, cur.ProviderKeyID, cur.Protocol, cur.BaseURL, cur.Status, cur.Priority, cur.Weight, joinCSV(cur.Models))
	if err != nil {
		return nil, err
	}
	return &cur, nil
}

func (p *Postgres) DisableChannel(ctx context.Context, id int64) error {
	res, err := p.DB.ExecContext(ctx, `UPDATE channels SET status='disabled' WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) ListVirtualKeys(ctx context.Context) ([]VirtualKeyAdmin, error) {
	rows, err := p.DB.QueryContext(ctx, `
SELECT id, pool_id, COALESCE(project_id,0), status, key_prefix, key_masked, expires_at, model_scope, ip_allow,
       rpm_limit, rpm_burst, monthly_token_hard, monthly_token_soft
FROM virtual_keys ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VirtualKeyAdmin
	for rows.Next() {
		v, err := scanVKAdmin(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

func (p *Postgres) checkVKRefs(ctx context.Context, poolID, projectID int64) error {
	poolTeam, err := p.poolMeta(ctx, poolID)
	if err != nil {
		return err
	}
	if projectID == 0 {
		return nil
	}
	projTeam, err := p.projectTeam(ctx, projectID)
	if err != nil {
		return err
	}
	if projTeam != poolTeam {
		return badRequest("team mismatch")
	}
	return nil
}

func (p *Postgres) CreateVirtualKey(ctx context.Context, in VirtualKeyAdmin) (*VirtualKeyAdmin, string, error) {
	if err := validateVKWrite(&in); err != nil {
		return nil, "", err
	}
	if err := p.checkVKRefs(ctx, in.PoolID, in.ProjectID); err != nil {
		return nil, "", err
	}
	raw, err := secret.NewVK()
	if err != nil {
		return nil, "", err
	}
	in.KeyPrefix = secret.PrefixVK(raw)
	in.KeyMasked = secret.MaskVK(raw)
	err = p.DB.QueryRowContext(ctx, `
INSERT INTO virtual_keys (
  key_hash, key_prefix, key_masked, pool_id, status, expires_at, model_scope, ip_allow,
  rpm_limit, rpm_burst, monthly_token_hard, monthly_token_soft, project_id
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id
`, secret.HashVK(raw), in.KeyPrefix, in.KeyMasked, in.PoolID, in.Status, nullTimePtr(in.ExpiresAt),
		joinCSV(in.ModelScope), joinCSV(in.IPAllow), in.RPMLimit, in.RPMBurst, in.MonthlyHard, in.MonthlySoft, nullInt(in.ProjectID)).Scan(&in.ID)
	if err != nil {
		return nil, "", err
	}
	return &in, raw, nil
}

func (p *Postgres) UpdateVirtualKey(ctx context.Context, id int64, in VirtualKeyPatch) (*VirtualKeyAdmin, error) {
	cur, err := p.getVKAdmin(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := applyVKPatch(cur, in); err != nil {
		return nil, err
	}
	if err := p.checkVKRefs(ctx, cur.PoolID, cur.ProjectID); err != nil {
		return nil, err
	}
	_, err = p.DB.ExecContext(ctx, `
UPDATE virtual_keys SET pool_id=$2, status=$3, expires_at=$4, model_scope=$5, ip_allow=$6,
  rpm_limit=$7, rpm_burst=$8, monthly_token_hard=$9, monthly_token_soft=$10, project_id=$11
WHERE id=$1
`, id, cur.PoolID, cur.Status, nullTimePtr(cur.ExpiresAt), joinCSV(cur.ModelScope), joinCSV(cur.IPAllow),
		cur.RPMLimit, cur.RPMBurst, cur.MonthlyHard, cur.MonthlySoft, nullInt(cur.ProjectID))
	if err != nil {
		return nil, err
	}
	return cur, nil
}

func (p *Postgres) DisableVirtualKey(ctx context.Context, id int64) error {
	res, err := p.DB.ExecContext(ctx, `UPDATE virtual_keys SET status='disabled' WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) getVKAdmin(ctx context.Context, id int64) (*VirtualKeyAdmin, error) {
	row := p.DB.QueryRowContext(ctx, `
SELECT id, pool_id, COALESCE(project_id,0), status, key_prefix, key_masked, expires_at, model_scope, ip_allow,
       rpm_limit, rpm_burst, monthly_token_hard, monthly_token_soft
FROM virtual_keys WHERE id=$1`, id)
	return scanVKAdmin(row)
}

func scanVKAdmin(row appScanner) (*VirtualKeyAdmin, error) {
	var v VirtualKeyAdmin
	var models, ips string
	var exp sql.NullTime
	if err := row.Scan(&v.ID, &v.PoolID, &v.ProjectID, &v.Status, &v.KeyPrefix, &v.KeyMasked, &exp, &models, &ips,
		&v.RPMLimit, &v.RPMBurst, &v.MonthlyHard, &v.MonthlySoft); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	v.ModelScope = splitCSV(models)
	v.IPAllow = splitCSV(ips)
	if exp.Valid {
		t := exp.Time
		v.ExpiresAt = &t
	}
	return &v, nil
}
