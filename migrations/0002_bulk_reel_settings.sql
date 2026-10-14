CREATE TABLE covers (
 id TEXT PRIMARY KEY, object_key TEXT UNIQUE NOT NULL, sha256 TEXT UNIQUE,
 name TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 2000000),
 width INTEGER NOT NULL, height INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN('uploading','ready','deleting')),
 created_at INTEGER NOT NULL
);
ALTER TABLE settings ADD COLUMN default_caption TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN default_cover_id TEXT REFERENCES covers(id) ON DELETE RESTRICT;
ALTER TABLE videos ADD COLUMN caption_override INTEGER NOT NULL DEFAULT 0 CHECK(caption_override IN(0,1));
ALTER TABLE videos ADD COLUMN cover_id TEXT REFERENCES covers(id) ON DELETE RESTRICT;
ALTER TABLE videos ADD COLUMN cover_override INTEGER NOT NULL DEFAULT 0 CHECK(cover_override IN(0,1));
ALTER TABLE videos ADD COLUMN thumb_offset_ms INTEGER NOT NULL DEFAULT 0;
UPDATE videos SET caption_override=1 WHERE caption<>'' OR hashtags<>'';
ALTER TABLE jobs ADD COLUMN cover_id TEXT REFERENCES covers(id) ON DELETE RESTRICT;
ALTER TABLE jobs ADD COLUMN thumb_offset_ms INTEGER NOT NULL DEFAULT 0;
CREATE INDEX video_cover ON videos(cover_id);
CREATE INDEX job_cover ON jobs(cover_id);
