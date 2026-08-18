package main

import (
	"context"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/icetomoyo/kodax-fabric/internal/fabric"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	store, err := fabric.OpenPostgres(ctx, dsn)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer store.Close()
	model := os.Getenv("SEED_MODEL")
	if err := store.Seed(ctx, fabric.HashAdminPassword(adminPass()), model); err != nil {
		log.Fatalf("seed: %v", err)
	}

	provider, err := newProvider()
	if err != nil {
		log.Fatalf("provider: %v", err)
	}
	srv := fabric.NewServer(store, provider)
	if key, err := masterKey(); err != nil {
		log.Fatalf("master key: %v", err)
	} else if key != nil {
		srv.MasterKey = key
	}
	if os.Getenv("PROVIDER_MODE") == "live" {
		srv.UseRegistry = true
	}

	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	httpSrv := &http.Server{Addr: addr, Handler: srv.Handler()}
	go func() {
		log.Printf("fabric listening on %s", addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdown)
}

func masterKey() ([]byte, error) {
	raw := os.Getenv("FABRIC_MASTER_KEY")
	if raw == "" {
		if os.Getenv("PROVIDER_MODE") == "live" {
			return nil, errors.New("FABRIC_MASTER_KEY is required when PROVIDER_MODE=live")
		}
		return nil, nil
	}
	if b, err := hex.DecodeString(raw); err == nil && len(b) == 32 {
		return b, nil
	}
	if len(raw) == 32 {
		return []byte(raw), nil
	}
	return nil, errors.New("FABRIC_MASTER_KEY must be 32 bytes or 64 hex chars")
}

func adminPass() string {
	if p := os.Getenv("ADMIN_PASSWORD"); p != "" {
		return p
	}
	return fabric.SeedAdminPass
}

func newProvider() (fabric.Provider, error) {
	if os.Getenv("PROVIDER_MODE") == "live" {
		base := os.Getenv("PROVIDER_BASE_URL")
		key := os.Getenv("PROVIDER_KEY")
		if base == "" || key == "" {
			return nil, errProviderConfig
		}
		log.Printf("provider live %s", base)
		return fabric.NewLiveProvider(base, key), nil
	}
	fixturePath := os.Getenv("FIXTURE_PATH")
	if fixturePath == "" {
		fixturePath = "testdata/fixtures/openai/chat_completion.json"
	}
	body, err := os.ReadFile(fixturePath)
	if err != nil {
		return nil, err
	}
	streamPath := os.Getenv("FIXTURE_STREAM_PATH")
	if streamPath == "" && strings.HasSuffix(fixturePath, ".json") {
		streamPath = strings.TrimSuffix(fixturePath, ".json") + ".sse"
	}
	streamBody, err := os.ReadFile(streamPath)
	if err != nil {
		streamBody = nil
	}
	msgPath := os.Getenv("FIXTURE_MESSAGES_PATH")
	if msgPath == "" {
		msgPath = "testdata/fixtures/anthropic/message.json"
	}
	msgBody, _ := os.ReadFile(msgPath)
	msgStream, _ := os.ReadFile(strings.TrimSuffix(msgPath, ".json") + ".sse")
	log.Printf("provider fixture %s", fixturePath)
	return &fabric.FixtureProvider{
		Body:               body,
		StreamBody:         streamBody,
		MessagesBody:       msgBody,
		MessagesStreamBody: msgStream,
	}, nil
}

var errProviderConfig = errors.New("PROVIDER_MODE=live requires PROVIDER_BASE_URL and PROVIDER_KEY")
