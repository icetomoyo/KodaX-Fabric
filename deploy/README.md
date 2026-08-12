# KodaX-Fabric deployment

Deploy artifacts for **KodaX Fabric** (Token Hub module). Runtime hostnames,
image names, and paths may still use the historical `tokenhub` prefix
(e.g. `tokenhub.haizhi.com`, `tokenhub-*` images) until a dedicated infra rename.

This directory is designed for an offline image import on the target host. The
runtime `.env` holds only long-lived service secrets; it must not contain the
initial administrator password.

Pilot-era operator runbooks were removed from the repo; this directory is the remaining deploy surface.

## First boot

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

The `api` container runs database migrations on every start
(`migrate.js` then `index.js`). Do not re-run bootstrap seed on routine upgrades.

## TLS

Production is served at `https://tokenhub.haizhi.com` with a CA-trusted
certificate. Before starting the `web` service, provision these files directly
on the target host under `/etc/tokenhub/tls/`, outside the source tree:

```text
/etc/tokenhub/tls/haizhi.com_cert_chain.pem
/etc/tokenhub/tls/haizhi.com_key.key
```

The certificate must cover `tokenhub.haizhi.com`; make the directory root-owned
with mode `0700` and both files root-owned with mode `0600`. Never commit,
copy into an image, or log the private key. A publicly trusted chain lets
browsers and supported API clients validate TLS without installing a
TokenHub-specific root certificate.

## Backup and restore

From the repository root:

```sh
sh deploy/backup.sh
ls -lah backups/tokenhub-*.sql.gz | tail -5
```

- Produces `backups/tokenhub-YYYYMMDD-HHMMSS.sql.gz` (local retention ~14 days).
- Copy archives to **independent** storage for disaster recovery.
- Redis is not included in the dump (rate-limit state only).
- Full restore: restore the gzip dump into a throwaway database first, then cut over.

## Upgrade (short form)

```sh
sh deploy/backup.sh
# load new images; update image tags in compose.yaml
cd deploy
docker compose up -d api web
curl -fsS https://tokenhub.haizhi.com/health
```

On failure, roll back image tags and `docker compose up -d api web`.
On schema changes, confirm `api` finished `migrate` before sending traffic.
