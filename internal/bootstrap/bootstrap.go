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
	AdminPhone     string
	AdminPassword  string
	DeepSeekKey    string
	DeepSeekBase   string
	VirtualKey     string
	VKOutPath      string
	EncryptKey     []byte
}

func DefaultConfig(enc []byte) Config {
	vk := os.Getenv("BOOTSTRAP_VIRTUAL_KEY")
	if vk == "" {
		vk = "fab-local-bootstrap-01"
	}
	base := os.Getenv("DEEPSEEK_BASE_URL")
	if base == "" {
		base = "https://api.deepseek.com"
	}
	out := os.Getenv("BOOTSTRAP_VK_FILE")
	if out == "" {
		out = "/data/virtual-key.txt"
	}
	return Config{
		AdminPhone:    envOr("ADMIN_PHONE", "18612243416"),
		AdminPassword: envOr("ADMIN_PASSWORD", "Hz@123456"),
		DeepSeekKey:   os.Getenv("DEEPSEEK_API_KEY"),
		DeepSeekBase:  base,
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
	if cfg.DeepSeekKey == "" {
		return fmt.Errorf("DEEPSEEK_API_KEY is required")
	}
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

	if _, err := db.ExecContext(ctx, `
INSERT INTO providers (code, name, default_base_url)
VALUES ('deepseek', 'DeepSeek', $1)
ON CONFLICT (code) DO UPDATE SET default_base_url = EXCLUDED.default_base_url
`, cfg.DeepSeekBase); err != nil {
		return fmt.Errorf("provider: %w", err)
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

	enc, err := secret.Encrypt(cfg.EncryptKey, cfg.DeepSeekKey)
	if err != nil {
		return err
	}
	var keyID int64
	err = db.QueryRowContext(ctx, `SELECT id FROM provider_keys WHERE provider_code = 'deepseek' ORDER BY id LIMIT 1`).Scan(&keyID)
	if err == sql.ErrNoRows {
		if err := db.QueryRowContext(ctx, `
INSERT INTO provider_keys (provider_code, secret_encrypted, status)
VALUES ('deepseek', $1, 'active')
RETURNING id
`, enc).Scan(&keyID); err != nil {
			return fmt.Errorf("provider key: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("provider key lookup: %w", err)
	} else if _, err := db.ExecContext(ctx, `UPDATE provider_keys SET secret_encrypted = $1, status = 'active' WHERE id = $2`, enc, keyID); err != nil {
		return fmt.Errorf("provider key update: %w", err)
	}

	var chID int64
	err = db.QueryRowContext(ctx, `
SELECT id FROM channels WHERE pool_id = $1 AND protocol = $2 LIMIT 1
`, poolID, store.ProtocolOpenAI).Scan(&chID)
	if err == sql.ErrNoRows {
		if _, err := db.ExecContext(ctx, `
INSERT INTO channels (pool_id, provider_key_id, protocol, base_url, status)
VALUES ($1, $2, $3, $4, 'active')
`, poolID, keyID, store.ProtocolOpenAI, cfg.DeepSeekBase); err != nil {
			return fmt.Errorf("channel: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("channel lookup: %w", err)
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
