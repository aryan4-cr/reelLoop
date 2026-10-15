import { HTTPException } from "hono/http-exception";
import type { Account, Env, Job, Settings, Video } from "./types";
import type { Lease } from "./lease";
import { captionText } from "./validation";
import { requireCover } from "./bulk";
import { nextSlot } from "./queue";
export interface Batch {
  id: string;
  state: string;
  scheduled_at: number;
  interval_minutes: number;
  cooldown_minutes: number;
  account_id: string;
  total: number;
  created_at: number;
  completed_at: number | null;
  next_item_at: number;
}
export interface BatchItem {
  id: string;
  batch_id: string;
  ordinal: number;
  video_id: string | null;
  video_name: string;
  object_key: string;
  caption: string;
  cover_id: string | null;
  thumb_offset_ms: number;
  state: string;
  job_id: string | null;
}
export function batchVideos(videos: Video[], s: Pick<Settings, "batch_size">) {
  const rows = videos
    .filter((v) => v.enabled && v.status === "ready")
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  return rows.slice(0, s.batch_size || 20);
}
export function batchVolume(count: number, interval: number) {
  return {
    average: (count * 1440) / interval,
    maximum: count * Math.ceil(1440 / interval),
  };
}
export async function activeBatch(env: Env) {
  return env.DB.prepare(
    "SELECT * FROM batches WHERE state='active'",
  ).first<Batch>();
}
export async function snapshotBatch(
  env: Env,
  lease: Lease,
  s: Settings,
  account: Account,
  videos: Video[],
) {
  if (
    !s.batch_size &&
    videos.filter((v) => v.enabled && v.status === "ready").length > 20
  )
    throw new HTTPException(409, {
      message: "Choose a batch size of at most 20 videos.",
    });
  const rows = batchVideos(videos, s);
  if (!rows.length)
    throw new HTTPException(409, {
      message: "No enabled verified videos for a batch.",
    });
  if (s.cooldown_minutes > s.interval_minutes)
    throw new HTTPException(409, {
      message:
        "Per-video cooldown exceeds the batch interval. Adjust settings before starting.",
    });
  const eligibleAt = Math.max(
    ...rows.map((v) => (v.last_published_at ?? 0) + s.cooldown_minutes * 60000),
  );
  if (eligibleAt > Date.now()) {
    await env.DB.prepare(
      `UPDATE settings SET next_publish_at=?,pause_reason='Batch delayed by per-video cooldown.' WHERE id=1 AND ${lease.guard()}`,
    )
      .bind(eligibleAt)
      .run();
    return null;
  }
  for (const v of rows) {
    captionText.parse([v.caption, v.hashtags].filter(Boolean).join("\n\n"));
    await requireCover(env, v.cover_id);
  }
  await lease.assert();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO batches(id,state,scheduled_at,interval_minutes,cooldown_minutes,account_id,total,created_at) SELECT ?,'active',?,?,?,?,?,? WHERE ${lease.guard()}`,
    ).bind(
      id,
      s.next_publish_at ?? Date.now(),
      s.interval_minutes,
      s.cooldown_minutes,
      account.instagram_id,
      rows.length,
      Date.now(),
    ),
    ...rows.map((v, i) =>
      env.DB.prepare(
        `INSERT INTO batch_items(id,batch_id,ordinal,video_id,video_name,object_key,caption,cover_id,thumb_offset_ms) SELECT ?,?,?,?,?,?,?,?,? WHERE ${lease.guard()}`,
      ).bind(
        crypto.randomUUID(),
        id,
        i,
        v.id,
        v.name,
        v.object_key,
        [v.caption, v.hashtags].filter(Boolean).join("\n\n"),
        v.cover_id,
        v.thumb_offset_ms,
      ),
    ),
  ]);
  return env.DB.prepare("SELECT * FROM batches WHERE id=?")
    .bind(id)
    .first<Batch>();
}
export async function nextBatchJob(
  env: Env,
  lease: Lease,
  batch: Batch,
): Promise<Job | null> {
  const latest = await env.DB.prepare(
    "SELECT MAX(actual_at) at FROM jobs WHERE batch_id=? AND state='succeeded'",
  )
    .bind(batch.id)
    .first<{ at: number | null }>();
  if (Math.max(batch.next_item_at, (latest?.at ?? 0) + 60000) > Date.now())
    return null;
  await env.DB.prepare(
    `UPDATE batch_items SET state='done' WHERE batch_id=? AND state='active' AND EXISTS(SELECT 1 FROM jobs WHERE id=batch_items.job_id AND state IN('succeeded','failed','skipped')) AND ${lease.guard()}`,
  )
    .bind(batch.id)
    .run();
  const item = await env.DB.prepare(
    "SELECT * FROM batch_items WHERE batch_id=? AND state='pending' ORDER BY ordinal LIMIT 1",
  )
    .bind(batch.id)
    .first<BatchItem>();
  if (!item) {
    const active = await env.DB.prepare(
      "SELECT id FROM batch_items WHERE batch_id=? AND state='active'",
    )
      .bind(batch.id)
      .first();
    if (active) throw new Error("Batch item has unresolved job state.");
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE batches SET state='completed',completed_at=? WHERE id=? AND state='active' AND ${lease.guard()}`,
      ).bind(Date.now(), batch.id),
      env.DB.prepare(
        `UPDATE settings SET next_publish_at=? WHERE id=1 AND ${lease.guard()}`,
      ).bind(nextSlot(batch.scheduled_at, Date.now(), batch.interval_minutes)),
    ]);
    return null;
  }
  const expires = Date.now() + 86400000;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO jobs(id,video_id,video_name,object_key,caption,scheduled_at,created_at,state,manual,media_expires_at,account_id,position,cover_id,thumb_offset_ms,batch_id) SELECT ?,?,?,?,?,?,?,'queued',0,?,?,?,?,?,? WHERE ${lease.guard()}`,
    ).bind(
      item.id,
      item.video_id,
      item.video_name,
      item.object_key,
      item.caption,
      batch.scheduled_at,
      Date.now(),
      expires,
      batch.account_id,
      item.ordinal,
      item.cover_id,
      item.thumb_offset_ms,
      batch.id,
    ),
    env.DB.prepare(
      `UPDATE batch_items SET state='active',job_id=? WHERE id=? AND state='pending' AND ${lease.guard()}`,
    ).bind(item.id, item.id),
  ]);
  return env.DB.prepare("SELECT * FROM jobs WHERE id=?")
    .bind(item.id)
    .first<Job>();
}
export async function cancelBatch(env: Env, lease: Lease) {
  const b = await activeBatch(env);
  if (!b) throw new HTTPException(409, { message: "No active batch." });
  const job = await env.DB.prepare(
    "SELECT * FROM jobs WHERE batch_id=? AND state IN('queued','creating','processing','ready','publishing','uncertain')",
  )
    .bind(b.id)
    .first<Job>();
  if (job && ["publishing", "uncertain"].includes(job.state))
    throw new HTTPException(409, {
      message:
        "Reconcile the uncertain publication before cancelling this batch.",
    });
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE jobs SET state='skipped',error='Unpublished batch item cancelled by owner.' WHERE batch_id=? AND state IN('queued','creating','processing','ready') AND ${lease.guard()}`,
    ).bind(b.id),
    env.DB.prepare(
      `UPDATE batch_items SET state=CASE WHEN state='pending' THEN 'cancelled' ELSE 'done' END WHERE batch_id=? AND state IN('pending','active') AND ${lease.guard()}`,
    ).bind(b.id),
    env.DB.prepare(
      `UPDATE batches SET state='cancelled',completed_at=? WHERE id=? AND ${lease.guard()}`,
    ).bind(Date.now(), b.id),
    env.DB.prepare(
      `UPDATE settings SET enabled=0,next_publish_at=?,pause_reason='Batch cancelled by owner.' WHERE id=1 AND ${lease.guard()}`,
    ).bind(nextSlot(b.scheduled_at, Date.now(), b.interval_minutes)),
  ]);
}
