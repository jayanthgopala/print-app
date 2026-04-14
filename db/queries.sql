-- PostgreSQL schema and operational query catalog for the hardened system

CREATE TABLE IF NOT EXISTS shops (
    id UUID PRIMARY KEY,
    shop_code TEXT NOT NULL UNIQUE,
    shop_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    color_price NUMERIC(10, 2),
    bw_price NUMERIC(10, 2),
    subscription_end TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    shop_code TEXT NOT NULL REFERENCES shops(shop_code) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    copies INTEGER NOT NULL DEFAULT 1,
    color_mode TEXT NOT NULL CHECK (color_mode IN ('color', 'bw')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'printing', 'completed', 'failed')),
    color_pages TEXT,
    bw_pages TEXT,
    paper_size TEXT,
    orientation TEXT,
    duplex TEXT,
    scale TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_failures (
    id UUID PRIMARY KEY,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    user_id TEXT,
    error_message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS request_rate_limits (
    rate_key TEXT PRIMARY KEY,
    window_start TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shops_shop_code ON shops (shop_code);
CREATE INDEX IF NOT EXISTS idx_admins_username ON admins (username);
CREATE INDEX IF NOT EXISTS idx_jobs_shop_code ON jobs (shop_code);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_shop_status_created ON jobs (shop_code, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_status_last_attempt ON jobs (status, last_attempt_at);
CREATE INDEX IF NOT EXISTS idx_jobs_failed_updated_at ON jobs (status, updated_at DESC) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS idx_job_failures_job_id_created_at ON job_failures (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_rate_limits_updated_at ON request_rate_limits (updated_at);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Insert queries
INSERT INTO admins (id, username, password_hash) VALUES ($1, $2, $3);
INSERT INTO shops (id, shop_code, shop_name, password_hash, color_price, bw_price, subscription_end) VALUES ($1, $2, $3, $4, $5, $6, $7);
INSERT INTO jobs (
    id, shop_code, file_url, object_key, file_name, content_type, copies, color_mode, status,
    color_pages, bw_pages, paper_size, orientation, duplex, scale, retry_count, last_attempt_at, last_error
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, 'pending',
    $9, $10, $11, $12, $13, $14, 0, NULL, NULL
);
INSERT INTO job_failures (id, job_id, user_id, error_message) VALUES ($1, $2, $3, $4);

-- Update queries
UPDATE shops SET shop_name = $2, color_price = $3, bw_price = $4, subscription_end = $5, updated_at = NOW() WHERE shop_code = $1;
UPDATE shops SET password_hash = $2, updated_at = NOW() WHERE shop_code = $1;
UPDATE jobs SET status = $2, retry_count = $3, last_attempt_at = NOW(), last_error = $4, updated_at = NOW() WHERE id = $1;
UPDATE jobs SET status = 'pending', retry_count = 0, last_attempt_at = NULL, last_error = NULL, updated_at = NOW() WHERE id = $1 AND status = 'failed';

-- Delete queries
DELETE FROM jobs WHERE id = $1;
DELETE FROM shops WHERE shop_code = $1;
DELETE FROM admins WHERE username = $1;
DELETE FROM request_rate_limits WHERE updated_at < NOW() - INTERVAL '1 day';

-- Queue/claim query
WITH candidates AS (
    SELECT id
    FROM jobs
    WHERE shop_code = $1 AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED
)
UPDATE jobs AS job
SET status = 'printing',
    last_attempt_at = NOW(),
    updated_at = NOW()
FROM candidates
WHERE job.id = candidates.id
RETURNING job.*;
