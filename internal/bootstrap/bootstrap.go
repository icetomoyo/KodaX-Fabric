package bootstrap

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"kodax-fabric/internal/secret"
	"kodax-fabric/internal/store"
)

type Config struct {
	AdminPhone    string
	AdminPassword string
	MockBase      string
	VirtualKey    string
	VKOutPath     string
	EncryptKey    []byte
}

func DefaultConfig(enc []byte) Config {
	vk := os.Getenv("BOOTSTRAP_VIRTUAL_KEY")
	if vk == "" {
		vk = "fab-local-bootstrap-01"
	}
	base := os.Getenv("MOCK_PROVIDER_URL")
	if base == "" {
		base = "http://mockprovider:9090"
	}
	out := os.Getenv("BOOTSTRAP_VK_FILE")
	return Config{
		AdminPhone:    envOr("ADMIN_PHONE", "18612243416"),
		AdminPassword: envOr("ADMIN_PASSWORD", "Hz@123456"),
		MockBase:      strings.TrimRight(base, "/"),
		VirtualKey:    vk,
		VKOutPath:     out,
		EncryptKey:    enc,
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func Run(ctx context.Context, db *sql.DB, cfg Config) error {
	if !strings.HasPrefix(cfg.VirtualKey, "fab-") {
		return fmt.Errorf("BOOTSTRAP_VIRTUAL_KEY must start with fab-")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO operators (phone, password_hash, role)
VALUES ($1, $2, 'admin')
ON CONFLICT (phone) DO UPDATE SET password_hash = EXCLUDED.password_hash
`, cfg.AdminPhone, string(hash)); err != nil {
		return fmt.Errorf("operator: %w", err)
	}

	var poolID int64
	if err := db.QueryRowContext(ctx, `
INSERT INTO channel_pools (name, group_name)
SELECT 'default', 'standard'
WHERE NOT EXISTS (SELECT 1 FROM channel_pools WHERE name = 'default')
RETURNING id
`).Scan(&poolID); err != nil {
		if err := db.QueryRowContext(ctx, `SELECT id FROM channel_pools WHERE name = 'default'`).Scan(&poolID); err != nil {
			return fmt.Errorf("pool: %w", err)
		}
	}

	if err := upsertMockChannel(ctx, db, cfg, poolID, "mock-openai", store.ProtocolOpenAI, "mock-openai"); err != nil {
		return err
	}
	if err := upsertMockChannel(ctx, db, cfg, poolID, "mock-anthropic", store.ProtocolAnthropic, "mock-anthropic"); err != nil {
		return err
	}

	prefix := cfg.VirtualKey
	if len(prefix) > 12 {
		prefix = prefix[:12]
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO virtual_keys (key_hash, key_prefix, pool_id, status)
VALUES ($1, $2, $3, 'active')
ON CONFLICT (key_hash) DO UPDATE SET pool_id = EXCLUDED.pool_id, status = 'active'
`, secret.HashVK(cfg.VirtualKey), prefix, poolID); err != nil {
		return fmt.Errorf("virtual key: %w", err)
	}

	if cfg.VKOutPath != "" {
		if err := os.WriteFile(cfg.VKOutPath, []byte(cfg.VirtualKey+"\n"), 0o600); err != nil {
			return fmt.Errorf("write vk file: %w", err)
		}
	}
	return nil
}

func upsertMockChannel(ctx context.Context, db *sql.DB, cfg Config, poolID int64, code, protocol, secretPlain string) error {
	enc, err := secret.Encrypt(cfg.EncryptKey, secretPlain)
	if err != nil {
		return err
	}
	var keyID int64
	err = db.QueryRowContext(ctx, `SELECT id FROM provider_keys WHERE provider_code = $1 ORDER BY id LIMIT 1`, code).Scan(&keyID)
	if err == sql.ErrNoRows {
		if err := db.QueryRowContext(ctx, `
INSERT INTO provider_keys (provider_code, secret_encrypted, status)
VALUES ($1, $2, 'active') RETURNING id
`, code, enc).Scan(&keyID); err != nil {
			return fmt.Errorf("provider %s: %w", code, err)
		}
	} else if err != nil {
		return fmt.Errorf("provider lookup %s: %w", code, err)
	} else if _, err := db.ExecContext(ctx, `UPDATE provider_keys SET secret_encrypted=$1, status='active' WHERE id=$2`, enc, keyID); err != nil {
		return fmt.Errorf("provider update %s: %w", code, err)
	}
	var chID int64
	err = db.QueryRowContext(ctx, `SELECT id FROM channels WHERE pool_id=$1 AND protocol=$2 LIMIT 1`, poolID, protocol).Scan(&chID)
	if err == sql.ErrNoRows {
		if _, err := db.ExecContext(ctx, `
INSERT INTO channels (pool_id, provider_key_id, protocol, base_url, status, weight)
VALUES ($1,$2,$3,$4,'active',100)
`, poolID, keyID, protocol, cfg.MockBase); err != nil {
			return fmt.Errorf("channel %s: %w", protocol, err)
		}
	} else if err != nil {
		return fmt.Errorf("channel lookup %s: %w", protocol, err)
	} else if _, err := db.ExecContext(ctx, `UPDATE channels SET provider_key_id=$1, base_url=$2, status='active' WHERE id=$3`, keyID, cfg.MockBase, chID); err != nil {
		return fmt.Errorf("channel update %s: %w", protocol, err)
	}
	return nil
}
