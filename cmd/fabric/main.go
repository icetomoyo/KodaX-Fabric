package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
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
	if err := store.Seed(ctx, fabric.HashAdminPassword(adminPass())); err != nil {
		log.Fatalf("seed: %v", err)
	}

	fixturePath := os.Getenv("FIXTURE_PATH")
	if fixturePath == "" {
		fixturePath = "testdata/fixtures/openai/chat_completion.json"
	}
	body, err := os.ReadFile(fixturePath)
	if err != nil {
		log.Fatalf("fixture: %v", err)
	}
	srv := fabric.NewServer(store, &fabric.FixtureProvider{Body: body})

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

func adminPass() string {
	if p := os.Getenv("ADMIN_PASSWORD"); p != "" {
		return p
	}
	return fabric.SeedAdminPass
}
