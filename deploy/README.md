# TokenHub deployment

This directory is designed for an offline image import on the target host. The
runtime `.env` holds only long-lived service secrets; it must not contain the
initial administrator password.

After importing the four `tokenhub-*` images and creating `deploy/.env`:

```sh
docker compose up -d postgres redis
SEED_ADMIN_PHONE='your-phone' \
SEED_ADMIN_PASSWORD='a-one-time-strong-password' \
sh bootstrap-admin.sh
docker compose up -d
```

`bootstrap-admin.sh` is intentionally a one-shot action. Do not put
`SEED_ADMIN_*` in `.env`, as the account may be renamed after first login.

The current IP-only deployment uses Caddy's internal certificate authority.
Install `caddy-root-ca.crt` from the server (or the generated local runtime
copy) in each browser/CLI trust store before connecting to
`https://10.10.0.144`; do not work around certificate verification in clients.

Run `sh backup.sh` for a verified PostgreSQL dump. The deployment creates a
daily local schedule, but copy the resulting `backups/` files to independent
storage for disaster recovery.
