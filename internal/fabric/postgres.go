package fabric

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
)

//go:embed schema.sql
var schemaSQL string

type PostgresStore struct {
	db *sql.DB
}

func OpenPostgres(ctx context.Context, dsn string) (*PostgresStore, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	s := &PostgresStore{db: db}
	if _, err := db.ExecContext(ctx, schemaSQL); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *PostgresStore) Close() error {
	return s.db.Close()
}

func (s *PostgresStore) Seed(ctx context.Context, adminHash, model string) error {
	if model == "" {
		model = SeedModel
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `INSERT INTO projects (name) VALUES ($1) ON CONFLICT DO NOTHING`, SeedProject); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO virtual_keys (hash, project_name, disabled)
		VALUES ($1, $2, FALSE)
		ON CONFLICT DO NOTHING`, HashVirtualKey(SeedVirtualKey), SeedProject); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO models (name, family, disabled)
		VALUES ($1, 'openai', FALSE)
		ON CONFLICT DO NOTHING`, model); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO prices (model_name, input_cny, output_cny, cached_cny)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT DO NOTHING`, model, SeedInputPriceCNY, SeedOutputPriceCNY, SeedCachedPriceCNY); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO models (name, family, disabled)
		VALUES ($1, 'anthropic', FALSE)
		ON CONFLICT DO NOTHING`, SeedAnthropicModel); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO prices (model_name, input_cny, output_cny, cached_cny)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT DO NOTHING`, SeedAnthropicModel, SeedInputPriceCNY, SeedOutputPriceCNY, SeedCachedPriceCNY); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admins (username, password_hash)
		VALUES ($1, $2)
		ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`, SeedAdminUser, adminHash); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *PostgresStore) LookupVirtualKey(ctx context.Context, plaintext string) (VirtualKeyRecord, bool, error) {
	var rec VirtualKeyRecord
	err := s.db.QueryRowContext(ctx, `
		SELECT hash, project_name, disabled FROM virtual_keys WHERE hash = $1`, HashVirtualKey(plaintext)).
		Scan(&rec.Hash, &rec.Project, &rec.Disabled)
	if err == sql.ErrNoRows {
		return VirtualKeyRecord{}, false, nil
	}
	if err != nil {
		return VirtualKeyRecord{}, false, err
	}
	return rec, true, nil
}

func (s *PostgresStore) LookupModel(ctx context.Context, name string) (ModelRoute, bool, error) {
	var rec ModelRoute
	var provider sql.NullString
	var provDisabled sql.NullBool
	err := s.db.QueryRowContext(ctx, `
		SELECT m.name, m.family, m.disabled, m.provider_name, p.disabled
		FROM models m
		LEFT JOIN providers p ON p.name = m.provider_name
		WHERE m.name = $1`, name).
		Scan(&rec.Name, &rec.Family, &rec.Disabled, &provider, &provDisabled)
	if err == sql.ErrNoRows {
		return ModelRoute{}, false, nil
	}
	if err != nil {
		return ModelRoute{}, false, err
	}
	if provider.Valid {
		rec.Provider = provider.String
	}
	rec.ProviderDisabled = provDisabled.Valid && provDisabled.Bool
	return rec, true, nil
}

func (s *PostgresStore) CreateUpstream(ctx context.Context, u Upstream) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO providers (name, family, base_url, key_ciphertext, disabled)
		VALUES ($1,$2,$3,$4,$5)`, u.Name, u.Family, u.BaseURL, u.KeyCiphertext, u.Disabled)
	if err != nil && strings.Contains(err.Error(), "duplicate") {
		return errDuplicate
	}
	return err
}

func (s *PostgresStore) GetUpstream(ctx context.Context, name string) (Upstream, bool, error) {
	var u Upstream
	err := s.db.QueryRowContext(ctx, `
		SELECT name, family, base_url, key_ciphertext, disabled FROM providers WHERE name = $1`, name).
		Scan(&u.Name, &u.Family, &u.BaseURL, &u.KeyCiphertext, &u.Disabled)
	if err == sql.ErrNoRows {
		return Upstream{}, false, nil
	}
	if err != nil {
		return Upstream{}, false, err
	}
	return u, true, nil
}

func (s *PostgresStore) ListUpstreams(ctx context.Context) ([]Upstream, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT name, family, base_url, key_ciphertext, disabled FROM providers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Upstream
	for rows.Next() {
		var u Upstream
		if err := rows.Scan(&u.Name, &u.Family, &u.BaseURL, &u.KeyCiphertext, &u.Disabled); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *PostgresStore) DisableUpstream(ctx context.Context, name string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE providers SET disabled = TRUE WHERE name = $1`, name)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *PostgresStore) CreateModel(ctx context.Context, route ModelRoute) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO models (name, family, disabled, provider_name)
		VALUES ($1,$2,$3,$4)`, route.Name, route.Family, route.Disabled, nullIfEmpty(route.Provider))
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "duplicate") {
		return errDuplicate
	}
	return err
}

func (s *PostgresStore) DisableModel(ctx context.Context, name string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE models SET disabled = TRUE WHERE name = $1`, name)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *PostgresStore) ListModels(ctx context.Context) ([]ModelRoute, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT name, family, disabled, COALESCE(provider_name,'') FROM models ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ModelRoute
	for rows.Next() {
		var rec ModelRoute
		if err := rows.Scan(&rec.Name, &rec.Family, &rec.Disabled, &rec.Provider); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *PostgresStore) UpsertPrice(ctx context.Context, price Price) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO prices (model_name, input_cny, output_cny, cached_cny)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (model_name) DO UPDATE SET
			input_cny = EXCLUDED.input_cny,
			output_cny = EXCLUDED.output_cny,
			cached_cny = EXCLUDED.cached_cny`,
		price.Model, price.InputCNY, price.OutputCNY, price.CachedCNY)
	return err
}

func (s *PostgresStore) DeletePrice(ctx context.Context, model string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM prices WHERE model_name = $1`, model)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *PostgresStore) ListPrices(ctx context.Context) ([]Price, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT model_name, input_cny, output_cny, cached_cny FROM prices ORDER BY model_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Price
	for rows.Next() {
		var p Price
		if err := rows.Scan(&p.Model, &p.InputCNY, &p.OutputCNY, &p.CachedCNY); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *PostgresStore) LookupPrice(ctx context.Context, model string) (Price, bool, error) {
	var p Price
	err := s.db.QueryRowContext(ctx, `
		SELECT input_cny, output_cny, cached_cny FROM prices WHERE model_name = $1`, model).
		Scan(&p.InputCNY, &p.OutputCNY, &p.CachedCNY)
	if err == sql.ErrNoRows {
		return Price{}, false, nil
	}
	if err != nil {
		return Price{}, false, err
	}
	p.Model = model
	return p, true, nil
}

func (s *PostgresStore) AppendRequest(ctx context.Context, row RequestRow) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO requests (
			virtual_key_hash, project_name, model,
			input_tokens, output_tokens, cached_tokens,
			cost_cny, status, created_at, run_id, task_type
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		row.VirtualKeyHash, row.Project, row.Model,
		row.InputTokens, row.OutputTokens, row.CachedTokens,
		row.CostCNY, row.Status, row.CreatedAt, row.RunID, row.TaskType)
	return err
}

func (s *PostgresStore) ListRequests(ctx context.Context, project string) ([]RequestRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT virtual_key_hash, project_name, model,
		       input_tokens, output_tokens, cached_tokens,
		       cost_cny, status, created_at, run_id, task_type
		FROM requests
		WHERE project_name = $1
		ORDER BY id`, project)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RequestRow
	for rows.Next() {
		var row RequestRow
		if err := rows.Scan(&row.VirtualKeyHash, &row.Project, &row.Model,
			&row.InputTokens, &row.OutputTokens, &row.CachedTokens,
			&row.CostCNY, &row.Status, &row.CreatedAt, &row.RunID, &row.TaskType); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *PostgresStore) UsageByProjectModelDay(ctx context.Context, project, day string) ([]UsageCell, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT project_name, model,
		       COUNT(*)::bigint,
		       SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END)::bigint,
		       SUM(CASE WHEN status < 400 AND input_tokens = 0 AND output_tokens = 0 AND cached_tokens = 0 THEN 1 ELSE 0 END)::bigint,
		       SUM(input_tokens), SUM(output_tokens), SUM(cached_tokens), SUM(cost_cny)
		FROM requests
		WHERE ($1 = '' OR project_name = $1)
		  AND ((created_at AT TIME ZONE 'Asia/Shanghai')::date) = $2::date
		GROUP BY project_name, model
		ORDER BY project_name, model`, project, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UsageCell
	for rows.Next() {
		var calls, failed, zero, in, outTok, cached int64
		cell := UsageCell{Day: day}
		if err := rows.Scan(&cell.Project, &cell.Model, &calls, &failed, &zero, &in, &outTok, &cached, &cell.CostCNY); err != nil {
			return nil, err
		}
		cell.Calls = int(calls)
		cell.FailedCalls = int(failed)
		cell.ZeroUsageCalls = int(zero)
		cell.InputTokens = int(in)
		cell.OutputTokens = int(outTok)
		cell.CachedTokens = int(cached)
		out = append(out, cell)
	}
	return out, rows.Err()
}

func (s *PostgresStore) CreateProject(ctx context.Context, name string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO projects (name) VALUES ($1) ON CONFLICT DO NOTHING`, name)
	return err
}

func (s *PostgresStore) ListProjects(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT name FROM projects ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ProjectExists(ctx context.Context, name string) (bool, error) {
	var n string
	err := s.db.QueryRowContext(ctx, `SELECT name FROM projects WHERE name = $1`, name).Scan(&n)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func (s *PostgresStore) CreateVirtualKey(ctx context.Context, rec VirtualKeyRecord) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO virtual_keys (hash, project_name, disabled)
		VALUES ($1, $2, $3)`, rec.Hash, rec.Project, rec.Disabled)
	return err
}

func (s *PostgresStore) GetVirtualKey(ctx context.Context, hash string) (VirtualKeyRecord, bool, error) {
	var rec VirtualKeyRecord
	err := s.db.QueryRowContext(ctx, `
		SELECT hash, project_name, disabled FROM virtual_keys WHERE hash = $1`, hash).
		Scan(&rec.Hash, &rec.Project, &rec.Disabled)
	if err == sql.ErrNoRows {
		return VirtualKeyRecord{}, false, nil
	}
	if err != nil {
		return VirtualKeyRecord{}, false, err
	}
	return rec, true, nil
}

func (s *PostgresStore) ListVirtualKeys(ctx context.Context) ([]VirtualKeyRecord, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT hash, project_name, disabled FROM virtual_keys ORDER BY hash`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VirtualKeyRecord
	for rows.Next() {
		var rec VirtualKeyRecord
		if err := rows.Scan(&rec.Hash, &rec.Project, &rec.Disabled); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *PostgresStore) DisableVirtualKey(ctx context.Context, hash string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE virtual_keys SET disabled = TRUE WHERE hash = $1`, hash)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *PostgresStore) AdminPasswordHash(ctx context.Context, username string) (string, bool, error) {
	var hash string
	err := s.db.QueryRowContext(ctx, `SELECT password_hash FROM admins WHERE username = $1`, username).Scan(&hash)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return hash, true, nil
}
