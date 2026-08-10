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

Run `sh backup.sh` for a verified PostgreSQL dump. The deployment creates a
daily local schedule, but copy the resulting `backups/` files to independent
storage for disaster recovery.
