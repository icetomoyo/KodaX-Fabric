package fabric

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
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

	if _, err := tx.ExecContext(ctx, `INSERT INTO enterprises (name, disabled) VALUES ($1, FALSE) ON CONFLICT DO NOTHING`, SeedEnterprise); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO projects (name, enterprise_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, SeedProject, SeedEnterprise); err != nil {
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
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO users (username, password_hash, role, enterprise_name, disabled)
		VALUES ($1, $2, $3, NULL, FALSE)
		ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
		SeedAdminUser, adminHash, RoleSuperAdmin); err != nil {
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
	attempts, err := json.Marshal(row.Attempts)
	if err != nil {
		return err
	}
	if row.Attempts == nil {
		attempts = []byte("[]")
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO requests (
			virtual_key_hash, project_name, model,
			input_tokens, output_tokens, cached_tokens,
			cost_cny, status, latency_ms, created_at, run_id, task_type, attempts
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		row.VirtualKeyHash, row.Project, row.Model,
		row.InputTokens, row.OutputTokens, row.CachedTokens,
		row.CostCNY, row.Status, row.LatencyMS, row.CreatedAt, row.RunID, row.TaskType, attempts)
	return err
}

func (s *PostgresStore) ListRequests(ctx context.Context, project string) ([]RequestRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT virtual_key_hash, project_name, model,
		       input_tokens, output_tokens, cached_tokens,
		       cost_cny, status, latency_ms, created_at, run_id, task_type,
		       COALESCE(attempts, '[]'::jsonb)
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
		var attempts []byte
		if err := rows.Scan(&row.VirtualKeyHash, &row.Project, &row.Model,
			&row.InputTokens, &row.OutputTokens, &row.CachedTokens,
			&row.CostCNY, &row.Status, &row.LatencyMS, &row.CreatedAt, &row.RunID, &row.TaskType, &attempts); err != nil {
			return nil, err
		}
		if len(attempts) > 0 {
			_ = json.Unmarshal(attempts, &row.Attempts)
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

func (s *PostgresStore) CreateProject(ctx context.Context, name, enterprise string) error {
	if enterprise == "" {
		enterprise = SeedEnterprise
	}
	var ent string
	err := s.db.QueryRowContext(ctx, `SELECT name FROM enterprises WHERE name = $1`, enterprise).Scan(&ent)
	if err == sql.ErrNoRows {
		return errUnknownEnterprise
	}
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO projects (name, enterprise_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, name, enterprise)
	return err
}

func (s *PostgresStore) AddMember(ctx context.Context, username, team string) error {
	if ok, err := s.ProjectExists(ctx, team); err != nil {
		return err
	} else if !ok {
		return errUnknownProject
	}
	if _, ok, err := s.GetUser(ctx, username); err != nil {
		return err
	} else if !ok {
		return errUnknownUser
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO memberships (username, team_name) VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, username, team)
	return err
}

func (s *PostgresStore) RemoveMember(ctx context.Context, username, team string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM memberships WHERE username = $1 AND team_name = $2`, username, team)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *PostgresStore) UserTeams(ctx context.Context, username string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT team_name FROM memberships WHERE username = $1 ORDER BY team_name`, username)
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
	if out == nil {
		out = []string{}
	}
	return out, rows.Err()
}

func (s *PostgresStore) CreateEnterprise(ctx context.Context, name string) error {
	res, err := s.db.ExecContext(ctx, `INSERT INTO enterprises (name, disabled) VALUES ($1, FALSE) ON CONFLICT DO NOTHING`, name)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return errDuplicate
	}
	return nil
}

func (s *PostgresStore) ListEnterprises(ctx context.Context) ([]Enterprise, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT name, disabled FROM enterprises ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Enterprise
	for rows.Next() {
		var e Enterprise
		if err := rows.Scan(&e.Name, &e.Disabled); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *PostgresStore) DisableEnterprise(ctx context.Context, name string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE enterprises SET disabled = TRUE WHERE name = $1`, name)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *PostgresStore) TeamEnterprise(ctx context.Context, team string) (Enterprise, bool, error) {
	var e Enterprise
	err := s.db.QueryRowContext(ctx, `
		SELECT e.name, e.disabled
		FROM projects t
		JOIN enterprises e ON e.name = COALESCE(t.enterprise_name, $2)
		WHERE t.name = $1`, team, SeedEnterprise).Scan(&e.Name, &e.Disabled)
	if err == sql.ErrNoRows {
		return Enterprise{}, false, nil
	}
	if err != nil {
		return Enterprise{}, false, err
	}
	return e, true, nil
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
	rec, ok, err := s.GetUser(ctx, username)
	if err != nil || !ok || rec.Disabled {
		if err != nil {
			return "", false, err
		}
		var hash string
		err = s.db.QueryRowContext(ctx, `SELECT password_hash FROM admins WHERE username = $1`, username).Scan(&hash)
		if err == sql.ErrNoRows {
			return "", false, nil
		}
		if err != nil {
			return "", false, err
		}
		return hash, true, nil
	}
	return rec.PasswordHash, rec.PasswordHash != "", nil
}

func (s *PostgresStore) GetUser(ctx context.Context, username string) (UserRecord, bool, error) {
	var rec UserRecord
	var enterprise sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT username, password_hash, role, enterprise_name, disabled
		FROM users WHERE username = $1`, username).
		Scan(&rec.Username, &rec.PasswordHash, &rec.Role, &enterprise, &rec.Disabled)
	if err == sql.ErrNoRows {
		return UserRecord{}, false, nil
	}
	if err != nil {
		return UserRecord{}, false, err
	}
	if enterprise.Valid {
		rec.Enterprise = enterprise.String
	}
	return rec, true, nil
}

func (s *PostgresStore) CreateUser(ctx context.Context, rec UserRecord) error {
	if rec.Enterprise != "" {
		var name string
		err := s.db.QueryRowContext(ctx, `SELECT name FROM enterprises WHERE name = $1`, rec.Enterprise).Scan(&name)
		if err == sql.ErrNoRows {
			return errUnknownEnterprise
		}
		if err != nil {
			return err
		}
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO users (username, password_hash, role, enterprise_name, disabled)
		VALUES ($1, $2, $3, $4, $5)`,
		rec.Username, rec.PasswordHash, rec.Role, nullIfEmpty(rec.Enterprise), rec.Disabled)
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "duplicate") {
		return errDuplicate
	}
	return err
}

func (s *PostgresStore) CreateProviderKey(ctx context.Context, rec ProviderKey) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO provider_keys (id, provider_name, key_ciphertext, disabled)
		VALUES ($1, $2, $3, $4)`, rec.ID, rec.Provider, rec.KeyCiphertext, rec.Disabled)
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "duplicate") {
		return errDuplicate
	}
	return err
}

func (s *PostgresStore) GetProviderKey(ctx context.Context, id string) (ProviderKey, bool, error) {
	var rec ProviderKey
	err := s.db.QueryRowContext(ctx, `
		SELECT id, provider_name, key_ciphertext, disabled FROM provider_keys WHERE id = $1`, id).
		Scan(&rec.ID, &rec.Provider, &rec.KeyCiphertext, &rec.Disabled)
	if err == sql.ErrNoRows {
		return ProviderKey{}, false, nil
	}
	if err != nil {
		return ProviderKey{}, false, err
	}
	return rec, true, nil
}

func (s *PostgresStore) ListProviderKeys(ctx context.Context, provider string) ([]ProviderKey, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, provider_name, key_ciphertext, disabled
		FROM provider_keys WHERE provider_name = $1 ORDER BY id`, provider)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProviderKey
	for rows.Next() {
		var rec ProviderKey
		if err := rows.Scan(&rec.ID, &rec.Provider, &rec.KeyCiphertext, &rec.Disabled); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if out == nil {
		out = []ProviderKey{}
	}
	return out, rows.Err()
}

func (s *PostgresStore) DisableProviderKey(ctx context.Context, id string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE provider_keys SET disabled = TRUE WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *PostgresStore) CreateChannel(ctx context.Context, ch Channel) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO channels (
			id, model_name, provider_key_id, weight, priority, disabled,
			has_price, input_cny, output_cny, cached_cny
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		ch.ID, ch.Model, ch.ProviderKey, ch.Weight, ch.Priority, ch.Disabled,
		ch.HasPrice, ch.InputCNY, ch.OutputCNY, ch.CachedCNY)
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "duplicate") {
		return errDuplicate
	}
	return err
}

func (s *PostgresStore) ListChannels(ctx context.Context, model string) ([]Channel, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, model_name, provider_key_id, weight, priority, disabled,
		       has_price, input_cny, output_cny, cached_cny
		FROM channels
		WHERE ($1 = '' OR model_name = $1)
		ORDER BY priority DESC, id`, model)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Channel
	for rows.Next() {
		var ch Channel
		if err := rows.Scan(&ch.ID, &ch.Model, &ch.ProviderKey, &ch.Weight, &ch.Priority, &ch.Disabled,
			&ch.HasPrice, &ch.InputCNY, &ch.OutputCNY, &ch.CachedCNY); err != nil {
			return nil, err
		}
		out = append(out, ch)
	}
	if out == nil {
		out = []Channel{}
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetChannel(ctx context.Context, id string) (Channel, bool, error) {
	var ch Channel
	err := s.db.QueryRowContext(ctx, `
		SELECT id, model_name, provider_key_id, weight, priority, disabled,
		       has_price, input_cny, output_cny, cached_cny
		FROM channels WHERE id = $1`, id).
		Scan(&ch.ID, &ch.Model, &ch.ProviderKey, &ch.Weight, &ch.Priority, &ch.Disabled,
			&ch.HasPrice, &ch.InputCNY, &ch.OutputCNY, &ch.CachedCNY)
	if err == sql.ErrNoRows {
		return Channel{}, false, nil
	}
	if err != nil {
		return Channel{}, false, err
	}
	return ch, true, nil
}

func (s *PostgresStore) DisableChannel(ctx context.Context, id string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE channels SET disabled = TRUE WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}
