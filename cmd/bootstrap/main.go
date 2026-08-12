package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"kodax-fabric/internal/bootstrap"
	"kodax-fabric/internal/secret"
	"kodax-fabric/internal/store"
)

func main() {
	encRaw := os.Getenv("CREDENTIAL_ENCRYPT_KEY")
	dsn := os.Getenv("DATABASE_URL")
	if encRaw == "" || dsn == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL and CREDENTIAL_ENCRYPT_KEY required")
		os.Exit(1)
	}
	key, err := secret.ParseAESKey(encRaw)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	db, err := store.OpenPostgres(dsn)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer db.Close()
	pg := &store.Postgres{DB: db, EncryptKey: key}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := pg.Migrate(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := bootstrap.Run(ctx, db, bootstrap.DefaultConfig(key)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("bootstrap ok")
}
