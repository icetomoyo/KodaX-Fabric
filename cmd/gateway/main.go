package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"kodax-fabric/internal/admin"
	"kodax-fabric/internal/bootstrap"
	"kodax-fabric/internal/hub"
	"kodax-fabric/internal/secret"
	"kodax-fabric/internal/store"
	"kodax-fabric/internal/webui"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	addr := envOr("LISTEN_ADDR", ":8080")
	dsn := os.Getenv("DATABASE_URL")
	encRaw := os.Getenv("CREDENTIAL_ENCRYPT_KEY")
	if dsn == "" || encRaw == "" {
		return fmt.Errorf("DATABASE_URL and CREDENTIAL_ENCRYPT_KEY are required")
	}
	key, err := secret.ParseAESKey(encRaw)
	if err != nil {
		return err
	}
	db, err := store.OpenPostgres(dsn)
	if err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	defer db.Close()
	pg := &store.Postgres{DB: db, EncryptKey: key}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := pg.Migrate(ctx); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if os.Getenv("SEED_ON_START") == "1" {
		if err := bootstrap.Run(ctx, db, bootstrap.DefaultConfig(key)); err != nil {
			return fmt.Errorf("bootstrap: %w", err)
		}
		fmt.Println("bootstrap complete")
	}

	h := hub.New(pg, nil)
	api := &admin.API{Cat: &admin.Catalog{DB: db, EncryptKey: key}, Sessions: admin.NewSessions()}
	ui := webui.Handler()

	mux := http.NewServeMux()
	mux.Handle("/api/", api.Handler())
	mux.Handle("/admin", ui)
	mux.Handle("/admin/", ui)
	mux.Handle("/me", ui)
	mux.Handle("/me/", ui)
	mux.Handle("/ui/", ui)
	mux.Handle("GET /{$}", ui)
	mux.Handle("/", h.Handler())
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		pgOK := db.PingContext(r.Context()) == nil
		redisOK := true
		if ru := os.Getenv("REDIS_URL"); ru != "" {
			redisOK = pingRedis(ru)
		}
		w.Header().Set("Content-Type", "application/json")
		status := http.StatusOK
		if !pgOK {
			status = http.StatusServiceUnavailable
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":       pgOK,
			"service":  "kodax-fabric-gateway",
			"postgres": pgOK,
			"redis":    redisOK,
		})
	})

	fmt.Println("token-hub gateway listening on", addr)
	return http.ListenAndServe(addr, mux)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func pingRedis(url string) bool {
	host := strings.TrimPrefix(url, "redis://")
	conn, err := net.DialTimeout("tcp", host, 400*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
