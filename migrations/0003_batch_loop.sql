CREATE TABLE batches (
 id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN('active','completed','cancelled')),
 scheduled_at INTEGER NOT NULL, interval_minutes INTEGER NOT NULL, cooldown_minutes INTEGER NOT NULL,
 account_id TEXT NOT NULL, total INTEGER NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER, next_item_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX one_active_batch ON batches((1)) WHERE state='active';
CREATE TABLE batch_items (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id), ordinal INTEGER NOT NULL,
 video_id TEXT REFERENCES videos(id) ON DELETE SET NULL, video_name TEXT NOT NULL, object_key TEXT NOT NULL,
 caption TEXT NOT NULL, cover_id TEXT REFERENCES covers(id) ON DELETE RESTRICT, thumb_offset_ms INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','active','done','cancelled')),
 job_id TEXT UNIQUE REFERENCES jobs(id), UNIQUE(batch_id,ordinal)
);
CREATE INDEX pending_batch_item ON batch_items(batch_id,state,ordinal);
ALTER TABLE jobs ADD COLUMN batch_id TEXT REFERENCES batches(id);
ALTER TABLE settings ADD COLUMN batch_enabled INTEGER NOT NULL DEFAULT 0 CHECK(batch_enabled IN(0,1));
ALTER TABLE settings ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 0 CHECK(batch_size BETWEEN 0 AND 20);
