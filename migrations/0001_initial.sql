PRAGMA foreign_keys = ON;
CREATE TABLE settings (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 interval_minutes INTEGER NOT NULL DEFAULT 180 CHECK(interval_minutes BETWEEN 60 AND 10080),
 timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata', mode TEXT NOT NULL DEFAULT 'loop' CHECK(mode IN('loop','once')),
 cooldown_minutes INTEGER NOT NULL DEFAULT 1440 CHECK(cooldown_minutes>=0), next_publish_at INTEGER,
 last_video_id TEXT, cursor_position INTEGER NOT NULL DEFAULT -1, failure_streak INTEGER NOT NULL DEFAULT 0,
 pause_reason TEXT, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO settings(id) VALUES(1);
CREATE TABLE accounts (
 id INTEGER PRIMARY KEY CHECK(id=1), instagram_id TEXT NOT NULL, username TEXT NOT NULL,
 token_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL, refreshed_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN('connected','reauth_required'))
);
CREATE TABLE videos (
 id TEXT PRIMARY KEY, object_key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 1000000000), duration_seconds REAL NOT NULL CHECK(duration_seconds BETWEEN 3 AND 900),
 width INTEGER NOT NULL, height INTEGER NOT NULL, caption TEXT NOT NULL DEFAULT '', hashtags TEXT NOT NULL DEFAULT '',
 position INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN('uploading','ready','deleting')),
 multipart_id TEXT, created_at INTEGER NOT NULL, last_published_at INTEGER, publish_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX video_queue ON videos(status,enabled,position,id);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY, video_id TEXT REFERENCES videos(id) ON DELETE SET NULL, video_name TEXT NOT NULL,
 object_key TEXT NOT NULL, caption TEXT NOT NULL, scheduled_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN('queued','creating','processing','ready','publishing','uncertain','succeeded','failed','skipped')),
 manual INTEGER NOT NULL DEFAULT 0, container_id TEXT, media_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 retry_at INTEGER NOT NULL DEFAULT 0, processing_started_at INTEGER, actual_at INTEGER,
 error TEXT, media_expires_at INTEGER NOT NULL, account_id TEXT NOT NULL, position INTEGER NOT NULL
);
CREATE UNIQUE INDEX one_active_job ON jobs((1)) WHERE state IN('queued','creating','processing','ready','publishing','uncertain');
CREATE INDEX job_history ON jobs(created_at DESC);
CREATE INDEX job_due ON jobs(state,retry_at);
CREATE TABLE job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
CREATE INDEX event_job ON job_events(job_id,at);
CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX session_expiry ON sessions(expires_at);
CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
