package store

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"kodax-fabric/internal/secret"
)

func (p *Postgres) CreateVKApplication(ctx context.Context, app VKApplication) (*VKApplication, error) {
	var id int64
	err := p.DB.QueryRowContext(ctx, `
INSERT INTO vk_applications (
  team_id, project_id, pool_id, purpose, monthly_token_hard, monthly_token_soft,
  model_scope, expires_at, ip_allow, status, created_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, now()))
RETURNING id
`, nullInt(app.TeamID), nullInt(app.ProjectID), nullInt(app.PoolID), app.Purpose,
		app.MonthlyHard, app.MonthlySoft, joinCSV(app.ModelScope), nullTimePtr(app.ExpiresAt),
		joinCSV(app.IPAllow), AppPending, nullTime(app.CreatedAt)).Scan(&id)
	if err != nil {
		return nil, err
	}
	return p.GetVKApplication(ctx, id)
}

func (p *Postgres) GetVKApplication(ctx context.Context, id int64) (*VKApplication, error) {
	row := p.DB.QueryRowContext(ctx, `
SELECT id, COALESCE(team_id,0), COALESCE(project_id,0), COALESCE(pool_id,0), purpose,
       monthly_token_hard, monthly_token_soft, model_scope, expires_at, ip_allow,
       status, reject_reason, COALESCE(virtual_key_id,0), key_prefix, key_masked, created_at
FROM vk_applications WHERE id = $1
`, id)
	return scanApp(row)
}

func (p *Postgres) ListVKApplications(ctx context.Context) ([]VKApplication, error) {
	rows, err := p.DB.QueryContext(ctx, `
SELECT id, COALESCE(team_id,0), COALESCE(project_id,0), COALESCE(pool_id,0), purpose,
       monthly_token_hard, monthly_token_soft, model_scope, expires_at, ip_allow,
       status, reject_reason, COALESCE(virtual_key_id,0), key_prefix, key_masked, created_at
FROM vk_applications ORDER BY id
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VKApplication
	for rows.Next() {
		a, err := scanApp(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

func (p *Postgres) ApproveVKApplication(ctx context.Context, id int64, _ time.Time) (*VKApplication, string, error) {
	tx, err := p.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = tx.Rollback() }()
	row := tx.QueryRowContext(ctx, `
SELECT id, COALESCE(team_id,0), COALESCE(project_id,0), COALESCE(pool_id,0), purpose,
       monthly_token_hard, monthly_token_soft, model_scope, expires_at, ip_allow,
       status, reject_reason, COALESCE(virtual_key_id,0), key_prefix, key_masked, created_at
FROM vk_applications WHERE id = $1 FOR UPDATE
`, id)
	app, err := scanApp(row)
	if err == sql.ErrNoRows {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	if app.Status != AppPending {
		return app, "", ErrAlreadyDecided
	}
	raw, err := secret.NewVK()
	if err != nil {
		return nil, "", err
	}
	var vkID int64
	err = tx.QueryRowContext(ctx, `
INSERT INTO virtual_keys (
  key_hash, key_prefix, pool_id, status, expires_at, model_scope,
  monthly_token_hard, monthly_token_soft, project_id, ip_allow
) VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9)
RETURNING id
`, secret.HashVK(raw), secret.PrefixVK(raw), app.PoolID, nullTimePtr(app.ExpiresAt),
		joinCSV(app.ModelScope), app.MonthlyHard, app.MonthlySoft, nullInt(app.ProjectID), joinCSV(app.IPAllow)).Scan(&vkID)
	if err != nil {
		return nil, "", err
	}
	_, err = tx.ExecContext(ctx, `
UPDATE vk_applications
SET status = $2, virtual_key_id = $3, key_prefix = $4, key_masked = $5
WHERE id = $1
`, id, AppApproved, vkID, secret.PrefixVK(raw), secret.MaskVK(raw))
	if err != nil {
		return nil, "", err
	}
	if err := tx.Commit(); err != nil {
		return nil, "", err
	}
	app.Status = AppApproved
	app.VirtualKeyID = vkID
	app.KeyPrefix = secret.PrefixVK(raw)
	app.KeyMasked = secret.MaskVK(raw)
	return app, raw, nil
}

func (p *Postgres) RejectVKApplication(ctx context.Context, id int64, reason string) (*VKApplication, error) {
	tx, err := p.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	row := tx.QueryRowContext(ctx, `
SELECT id, COALESCE(team_id,0), COALESCE(project_id,0), COALESCE(pool_id,0), purpose,
       monthly_token_hard, monthly_token_soft, model_scope, expires_at, ip_allow,
       status, reject_reason, COALESCE(virtual_key_id,0), key_prefix, key_masked, created_at
FROM vk_applications WHERE id = $1 FOR UPDATE
`, id)
	app, err := scanApp(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if app.Status != AppPending {
		return app, ErrAlreadyDecided
	}
	_, err = tx.ExecContext(ctx, `UPDATE vk_applications SET status = $2, reject_reason = $3 WHERE id = $1`, id, AppRejected, reason)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	app.Status = AppRejected
	app.RejectReason = reason
	return app, nil
}

func (p *Postgres) StageProviderRotation(ctx context.Context, keyID int64, secretPlain string, activate, retire *time.Time, now time.Time) error {
	act, ret, err := NormalizeRotationSchedule(activate, retire)
	if err != nil {
		return err
	}
	enc, err := secret.Encrypt(p.EncryptKey, secretPlain)
	if err != nil {
		return err
	}
	tx, err := p.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var curEnc, replEnc string
	var actAt, retAt sql.NullTime
	err = tx.QueryRowContext(ctx, `
SELECT secret_encrypted, COALESCE(replacement_encrypted, ''), replacement_activate_at, retire_at
FROM provider_keys WHERE id = $1 FOR UPDATE
`, keyID).Scan(&curEnc, &replEnc, &actAt, &retAt)
	if err == sql.ErrNoRows {
		return ErrKeyNotFound
	}
	if err != nil {
		return err
	}
	if replEnc != "" {
		var aPtr, rPtr *time.Time
		if actAt.Valid {
			t := actAt.Time
			aPtr = &t
		}
		if retAt.Valid {
			t := retAt.Time
			rPtr = &t
		}
		pending, overlap, done := ReplacementPhase(true, aPtr, rPtr, now)
		if pending || overlap {
			return ErrRotationConflict
		}
		if done {
			curEnc = replEnc
		}
	}
	_, err = tx.ExecContext(ctx, `
UPDATE provider_keys
SET secret_encrypted = $2, replacement_encrypted = $3, replacement_activate_at = $4, retire_at = $5
WHERE id = $1
`, keyID, curEnc, enc, nullTimePtr(act), nullTimePtr(ret))
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (p *Postgres) ActivateProviderRotation(ctx context.Context, keyID int64, now time.Time) error {
	tx, err := p.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var repl string
	var retAt sql.NullTime
	err = tx.QueryRowContext(ctx, `
SELECT COALESCE(replacement_encrypted, ''), retire_at
FROM provider_keys WHERE id = $1 FOR UPDATE
`, keyID).Scan(&repl, &retAt)
	if err == sql.ErrNoRows {
		return ErrKeyNotFound
	}
	if err != nil {
		return err
	}
	if repl == "" {
		return ErrNoReplacement
	}
	retire := now.Add(DefaultRotationGrace)
	if retAt.Valid {
		retire = retAt.Time
	}
	if !retire.After(now) {
		return ErrInvalidRotationSchedule
	}
	_, err = tx.ExecContext(ctx, `
UPDATE provider_keys SET replacement_activate_at = $2, retire_at = $3 WHERE id = $1
`, keyID, now, retire)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (p *Postgres) ListProviderKeys(ctx context.Context) ([]ProviderKeyView, error) {
	rows, err := p.DB.QueryContext(ctx, `
SELECT id, provider_code, status,
       COALESCE(replacement_encrypted, '') <> '',
       replacement_activate_at, retire_at
FROM provider_keys ORDER BY id
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProviderKeyView
	for rows.Next() {
		var v ProviderKeyView
		var act, ret sql.NullTime
		if err := rows.Scan(&v.ID, &v.ProviderCode, &v.Status, &v.HasReplacement, &act, &ret); err != nil {
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
		out = append(out, v)
	}
	return out, rows.Err()
}

type appScanner interface {
	Scan(dest ...any) error
}

func scanApp(row appScanner) (*VKApplication, error) {
	var a VKApplication
	var models, ips string
	var exp sql.NullTime
	if err := row.Scan(&a.ID, &a.TeamID, &a.ProjectID, &a.PoolID, &a.Purpose,
		&a.MonthlyHard, &a.MonthlySoft, &models, &exp, &ips,
		&a.Status, &a.RejectReason, &a.VirtualKeyID, &a.KeyPrefix, &a.KeyMasked, &a.CreatedAt); err != nil {
		return nil, err
	}
	a.ModelScope = splitCSV(models)
	a.IPAllow = splitCSV(ips)
	if exp.Valid {
		t := exp.Time
		a.ExpiresAt = &t
	}
	return &a, nil
}

func joinCSV(ss []string) string {
	return strings.Join(ss, ",")
}

func nullInt(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}

func nullTimePtr(t *time.Time) any {
	if t == nil || t.IsZero() {
		return nil
	}
	return *t
}
