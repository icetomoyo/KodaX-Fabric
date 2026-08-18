CREATE TABLE IF NOT EXISTS projects (
    name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS virtual_keys (
    hash TEXT PRIMARY KEY,
    project_name TEXT NOT NULL REFERENCES projects (name),
    disabled BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS providers (
    name TEXT PRIMARY KEY,
    family TEXT NOT NULL,
    base_url TEXT NOT NULL,
    key_ciphertext TEXT NOT NULL,
    disabled BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS models (
    name TEXT PRIMARY KEY,
    family TEXT NOT NULL,
    disabled BOOLEAN NOT NULL DEFAULT FALSE,
    provider_name TEXT
);

ALTER TABLE models ADD COLUMN IF NOT EXISTS provider_name TEXT;

CREATE TABLE IF NOT EXISTS prices (
    model_name TEXT PRIMARY KEY REFERENCES models (name),
    input_cny DOUBLE PRECISION NOT NULL,
    output_cny DOUBLE PRECISION NOT NULL,
    cached_cny DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
    id BIGSERIAL PRIMARY KEY,
    virtual_key_hash TEXT NOT NULL,
    project_name TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    cached_tokens INT NOT NULL,
    cost_cny DOUBLE PRECISION NOT NULL,
    status INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    run_id TEXT NOT NULL DEFAULT '',
    task_type TEXT NOT NULL DEFAULT ''
);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS run_id TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS admins (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL
);
