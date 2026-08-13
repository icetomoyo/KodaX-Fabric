package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"kodax-fabric/internal/bootstrap"
	"kodax-fabric/internal/hub"
	"kodax-fabric/internal/secret"
	"kodax-fabric/internal/store"
)

var (
	version = "v0.1.0"
	commit  = "unknown"
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
	if os.Getenv("REDIS_URL") == "" {
		return fmt.Errorf("REDIS_URL is required")
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

	ttl, err := hub.ParseCacheTTL(os.Getenv("CACHE_TTL"))
	if err != nil {
		return err
	}
	rdb, err := hub.OpenRedis(os.Getenv("REDIS_URL"))
	if err != nil {
		return err
	}
	defer rdb.Close()

	h := hub.New(pg, nil)
	h.AdminToken = os.Getenv("ADMIN_TOKEN")
	h.Cache = hub.NewRedisCache(rdb, ttl)
	h.Budget = hub.NewRedisBudget(rdb)
	h.Limits = hub.NewRedisLimiter(rdb, h.Clock)
	h.Redis = hub.RedisPinger{C: rdb}
	h.Version = version
	h.Commit = commit
	h.StartProbes()
	defer h.StopProbes()

	srv := &http.Server{
		Addr:              addr,
		Handler:           h.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// WriteTimeout left unset so SSE can stream.
	}
	errCh := make(chan error, 1)
	go func() {
		fmt.Println("token-hub gateway listening on", addr, version, commit)
		errCh <- srv.ListenAndServe()
	}()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			return err
		}
	case <-sig:
		shctx, shcancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shcancel()
		_ = srv.Shutdown(shctx)
	}
	return nil
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
