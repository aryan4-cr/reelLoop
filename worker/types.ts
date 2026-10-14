export interface Env {
  DB: D1Database;
  VIDEOS: R2Bucket;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  PUBLIC_ORIGIN: string;
  META_API_VERSION: string;
  R2_BUCKET_NAME: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  OWNER_PASSWORD_HASH: string;
  TOKEN_ENCRYPTION_KEY: string;
  MEDIA_SIGNING_KEY: string;
  META_APP_ID: string;
  META_APP_SECRET: string;
  MAX_STORAGE_BYTES: string;
}
export interface Settings {
  default_caption: string;
  default_cover_id: string | null;
  id: number;
  enabled: number;
  interval_minutes: number;
  timezone: string;
  mode: "loop" | "once";
  cooldown_minutes: number;
  next_publish_at: number | null;
  last_video_id: string | null;
  cursor_position: number;
  failure_streak: number;
  pause_reason: string | null;
  lease_token: string | null;
  lease_until: number;
}
export interface Video {
  caption_override: number;
  cover_id: string | null;
  cover_override: number;
  thumb_offset_ms: number;
  id: string;
  object_key: string;
  name: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number;
  width: number;
  height: number;
  caption: string;
  hashtags: string;
  position: number;
  enabled: number;
  status: "uploading" | "ready" | "deleting";
  multipart_id: string | null;
  created_at: number;
  last_published_at: number | null;
  publish_count: number;
}
export interface Account {
  instagram_id: string;
  username: string;
  token_cipher: string;
  expires_at: number;
  refreshed_at: number;
  status: string;
}
export interface Job {
  cover_id: string | null;
  thumb_offset_ms: number;
  id: string;
  video_id: string | null;
  video_name: string;
  object_key: string;
  caption: string;
  scheduled_at: number;
  created_at: number;
  state: string;
  manual: number;
  container_id: string | null;
  media_id: string | null;
  attempts: number;
  retry_at: number;
  processing_started_at: number | null;
  actual_at: number | null;
  error: string | null;
  media_expires_at: number;
  account_id: string;
  position: number;
}
export const ACTIVE =
  "'queued','creating','processing','ready','publishing','uncertain'";
export interface Cover {
  id: string;
  object_key: string;
  sha256: string | null;
  name: string;
  size_bytes: number;
  width: number;
  height: number;
  status: "uploading" | "ready" | "deleting";
  created_at: number;
}
