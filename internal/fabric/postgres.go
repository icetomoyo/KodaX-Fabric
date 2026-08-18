package fabric

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"

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
		INSERT INTO admins (username, password_hash)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, SeedAdminUser, adminHash); err != nil {
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
	err := s.db.QueryRowContext(ctx, `SELECT name, family, disabled FROM models WHERE name = $1`, name).
		Scan(&rec.Name, &rec.Family, &rec.Disabled)
	if err == sql.ErrNoRows {
		return ModelRoute{}, false, nil
	}
	if err != nil {
		return ModelRoute{}, false, err
	}
	return rec, true, nil
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
	return p, true, nil
}

func (s *PostgresStore) AppendRequest(ctx context.Context, row RequestRow) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO requests (
			virtual_key_hash, project_name, model,
			input_tokens, output_tokens, cached_tokens,
			cost_cny, status, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		row.VirtualKeyHash, row.Project, row.Model,
		row.InputTokens, row.OutputTokens, row.CachedTokens,
		row.CostCNY, row.Status, row.CreatedAt)
	return err
}

func (s *PostgresStore) ListRequests(ctx context.Context, project string) ([]RequestRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT virtual_key_hash, project_name, model,
		       input_tokens, output_tokens, cached_tokens,
		       cost_cny, status, created_at
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
			&row.CostCNY, &row.Status, &row.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *PostgresStore) UsageByProjectModelDay(ctx context.Context, project, day string) ([]UsageCell, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT model,
		       SUM(input_tokens), SUM(output_tokens), SUM(cached_tokens), SUM(cost_cny)
		FROM requests
		WHERE project_name = $1
		  AND ((created_at AT TIME ZONE 'Asia/Shanghai')::date) = $2::date
		GROUP BY model
		ORDER BY model`, project, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UsageCell
	for rows.Next() {
		var in, outTok, cached int64
		cell := UsageCell{Project: project, Day: day}
		if err := rows.Scan(&cell.Model, &in, &outTok, &cached, &cell.CostCNY); err != nil {
			return nil, err
		}
		cell.InputTokens = int(in)
		cell.OutputTokens = int(outTok)
		cell.CachedTokens = int(cached)
		out = append(out, cell)
	}
	return out, rows.Err()
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
