import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync } from "node:fs";
import { pbkdf2Sync } from "node:crypto";
import { vi } from "vitest";
import type { Env, Job, Settings, Video } from "../worker/types";
import { encryptToken } from "../worker/security";
import type { MetaAdapter } from "../worker/instagram";
export let mf: Miniflare;
export let env: Env;
export let now = 1800000000000;
export async function init() {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test fixture")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: { DB: "reelloop-test" },
      r2Buckets: { VIDEOS: "reelloop-test" },
    }),
  );
  env = {
    DB: await mf.getD1Database("DB"),
    VIDEOS: await mf.getR2Bucket("VIDEOS"),
    ASSETS: { fetch: async () => new Response("assets") },
    APP_ORIGIN: "https://reelloop.example",
    PUBLIC_ORIGIN: "https://reelloop.example",
    META_API_VERSION: "v25.0",
    R2_BUCKET_NAME: "test",
    R2_ACCOUNT_ID: "test",
    R2_ACCESS_KEY_ID: "test",
    R2_SECRET_ACCESS_KEY: "test",
    MAX_STORAGE_BYTES: "10737418240",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    MEDIA_SIGNING_KEY: "test-signing-key-used-only-in-tests-12345",
    OWNER_PASSWORD_HASH: `pbkdf2$100000$testsalt$${pbkdf2Sync("test-password-only", "testsalt", 100000, 32, "sha256").toString("hex")}`,
    META_APP_ID: "test",
    META_APP_SECRET: "test",
  } as unknown as Env;
  const sql =
    readFileSync(
      new URL("../migrations/0001_initial.sql", import.meta.url),
      "utf8",
    ).replace(/^\uFEFF/, "") +
    readFileSync(
      new URL("../migrations/0002_bulk_reel_settings.sql", import.meta.url),
      "utf8",
    ) +
    readFileSync(
      new URL("../migrations/0003_batch_loop.sql", import.meta.url),
      "utf8",
    );
  await env.DB.batch(
    sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => env.DB.prepare(s)),
  );
}
export async function reset() {
  vi.restoreAllMocks();
  now = 1800000000000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  await env.DB.prepare(
    "UPDATE settings SET default_caption='',default_cover_id=NULL",
  ).run();
  await env.DB.batch(
    [
      "job_events",
      "batch_items",
      "jobs",
      "batches",
      "videos",
      "accounts",
      "sessions",
      "oauth_states",
      "rate_limits",
      "covers",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  await env.DB.prepare(
    "UPDATE settings SET batch_enabled=0,batch_size=0,enabled=0,interval_minutes=180,timezone='Asia/Kolkata',mode='loop',cooldown_minutes=0,next_publish_at=NULL,last_video_id=NULL,cursor_position=-1,failure_streak=0,pause_reason=NULL,lease_token=NULL,lease_until=0",
  ).run();
}
export function advance(ms = 61000) {
  now += ms;
}
export async function account() {
  await env.DB.prepare(
    "INSERT INTO accounts(id,instagram_id,username,token_cipher,expires_at,refreshed_at,status) VALUES(1,'123','testcreator',?,?,?,'connected')",
  )
    .bind(await encryptToken(env, "test-token-only"), now + 30 * 86400000, now)
    .run();
}
export async function video(id = "a", position = 0, status = "ready") {
  await env.DB.prepare(
    "INSERT INTO videos(id,object_key,name,content_type,size_bytes,duration_seconds,width,height,position,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      `videos/${id}`,
      id + ".mp4",
      "video/mp4",
      16,
      5,
      1080,
      1920,
      position,
      status,
      now,
    )
    .run();
  return (await env.DB.prepare("SELECT * FROM videos WHERE id=?")
    .bind(id)
    .first<Video>())!;
}
export async function start() {
  await account();
  await video();
  await env.DB.prepare(
    "UPDATE settings SET enabled=1,next_publish_at=? WHERE id=1",
  )
    .bind(now)
    .run();
}
export async function job() {
  return (await env.DB.prepare(
    "SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1",
  ).first<Job>())!;
}
export async function settings() {
  return (await env.DB.prepare(
    "SELECT * FROM settings WHERE id=1",
  ).first<Settings>())!;
}
export function adapter() {
  return {
    createContainer: vi.fn(async () => "container-1"),
    status: vi.fn(async () => "FINISHED"),
    publish: vi.fn(async () => "media-1"),
    quota: vi.fn(async () => ({ used: 0, total: 100 })),
    refresh: vi.fn(async () => ({
      access_token: "refreshed-test-token",
      expires_in: 60 * 86400,
    })),
    media: vi.fn(async () => []),
  } satisfies MetaAdapter;
}
