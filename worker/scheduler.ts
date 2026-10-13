import {
  ACTIVE,
  type Env,
  type Job,
  type Settings,
  type Video,
  type Account,
} from "./types";
import { selectNext, nextSlot, backoff } from "./queue";
import { withLease, type Lease, BusyError } from "./lease";
import { Instagram, MetaError, type MetaAdapter } from "./instagram";
import { decryptToken, encryptToken, mediaUrl } from "./security";
export async function event(
  env: Env,
  id: string,
  kind: string,
  detail: string,
) {
  await env.DB.prepare(
    "INSERT INTO job_events(job_id,at,kind,detail) VALUES(?,?,?,?)",
  )
    .bind(id, Date.now(), kind, detail)
    .run();
}
async function change(
  env: Env,
  lease: Lease,
  job: Job,
  state: string,
  extras: {
    container?: string;
    media?: string;
    error?: string;
    retry?: number;
    attempts?: number;
  } = {},
) {
  const row = await env.DB.prepare(
    `UPDATE jobs SET state=?,container_id=COALESCE(?,container_id),media_id=COALESCE(?,media_id),error=?,retry_at=?,attempts=attempts+?,processing_started_at=CASE WHEN ?='processing' THEN COALESCE(processing_started_at,?) ELSE processing_started_at END WHERE id=? AND state=? AND (${lease.guard()}) AND (?<>'publishing' OR manual=1 OR EXISTS(SELECT 1 FROM settings WHERE enabled=1)) RETURNING id`,
  )
    .bind(
      state,
      extras.container ?? null,
      extras.media ?? null,
      extras.error ?? null,
      extras.retry ?? 0,
      extras.attempts ?? 0,
      state,
      Date.now(),
      job.id,
      job.state,
      state,
    )
    .first();
  if (!row) {
    if (state === "publishing") {
      await lease.assert();
      return false;
    }
    throw new Error("Job state changed or lease expired.");
  }
  job.state = state;
  if (extras.container) job.container_id = extras.container;
  if (extras.attempts) job.attempts += extras.attempts;
  await event(env, job.id, state, extras.error ?? "State transition");
  return true;
}
async function pause(env: Env, reason: string, lease: Lease) {
  await env.DB.prepare(
    `UPDATE settings SET enabled=0,pause_reason=? WHERE id=1 AND ${lease.guard()}`,
  )
    .bind(reason)
    .run();
}
export async function complete(
  env: Env,
  lease: Lease,
  job: Job,
  mediaId: string,
  actual = Date.now(),
) {
  await lease.assert();
  const s = await env.DB.prepare(
    "SELECT * FROM settings WHERE id=1",
  ).first<Settings>();
  if (!s) throw new Error("Settings missing");
  const eligible = `state IN('publishing','uncertain') AND ${lease.guard()}`;
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE videos SET last_published_at=?,publish_count=publish_count+1 WHERE id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND ${eligible})`,
    ).bind(actual, job.video_id, job.id),
    env.DB.prepare(
      `UPDATE settings SET last_video_id=CASE WHEN ?=0 THEN ? ELSE last_video_id END,cursor_position=CASE WHEN ?=0 THEN ? ELSE cursor_position END,next_publish_at=CASE WHEN ?=0 THEN ? ELSE next_publish_at END,failure_streak=0 WHERE id=1 AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND ${eligible})`,
    ).bind(
      job.manual,
      job.video_id,
      job.manual,
      job.position,
      job.manual,
      nextSlot(
        job.scheduled_at,
        Math.max(actual, Date.now()),
        s.interval_minutes,
      ),
      job.id,
    ),
    env.DB.prepare(
      `UPDATE jobs SET state='succeeded',media_id=?,actual_at=?,error=NULL WHERE id=? AND ${eligible}`,
    ).bind(mediaId, actual, job.id),
  ]);
  if (!result[2].meta.changes) return;
  await event(env, job.id, "succeeded", `Published media ${mediaId}`);
}
async function fail(env: Env, lease: Lease, job: Job, reason: string) {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE jobs SET state='failed',error=? WHERE id=? AND ${lease.guard()}`,
    ).bind(reason, job.id),
    env.DB.prepare(
      `UPDATE settings SET failure_streak=failure_streak+1,next_publish_at=?,enabled=CASE WHEN failure_streak>=2 THEN 0 ELSE enabled END,pause_reason=CASE WHEN failure_streak>=2 THEN 'Paused after three failed jobs. Review history.' ELSE pause_reason END WHERE id=1 AND ${lease.guard()}`,
    ).bind(Date.now() + 3600000),
  ]);
  await event(env, job.id, "failed", reason);
}
export async function createJob(
  env: Env,
  lease: Lease,
  video: Video,
  account: Account,
  manual: boolean,
  scheduled: number,
) {
  await lease.assert();
  const id = crypto.randomUUID();
  const now = Date.now();
  const expires = now + 24 * 3600000;
  await env.DB.prepare(
    `INSERT INTO jobs(id,video_id,video_name,object_key,caption,scheduled_at,created_at,state,manual,media_expires_at,account_id,position) SELECT ?,?,?,?,?,?,?,'queued',?,?,?,? WHERE ${lease.guard()}`,
  )
    .bind(
      id,
      video.id,
      video.name,
      video.object_key,
      [video.caption, video.hashtags].filter(Boolean).join("\n\n"),
      scheduled,
      now,
      manual ? 1 : 0,
      expires,
      account.instagram_id,
      video.position,
    )
    .run();
  await event(
    env,
    id,
    "queued",
    manual ? "Owner confirmed test publication" : "Scheduled publication",
  );
  return id;
}
export async function tick(
  env: Env,
  adapter: MetaAdapter = new Instagram(env),
) {
  try {
    await withLease(env, async (lease) => {
      let s = (await env.DB.prepare(
        "SELECT * FROM settings WHERE id=1",
      ).first<Settings>())!;
      let job = await env.DB.prepare(
        `SELECT * FROM jobs WHERE state IN(${ACTIVE}) LIMIT 1`,
      ).first<Job>();
      if (!job && (!s.enabled || (s.next_publish_at ?? Infinity) > Date.now()))
        return;
      if (job?.state === "uncertain") return;
      const account = await env.DB.prepare(
        "SELECT * FROM accounts WHERE id=1",
      ).first<Account>();
      if (
        !account ||
        account.status !== "connected" ||
        account.expires_at <= Date.now()
      ) {
        await pause(
          env,
          "Instagram authorization is missing or expired. Reconnect your account.",
          lease,
        );
        return;
      }
      if (job && job.account_id !== account.instagram_id) {
        await pause(
          env,
          "Job belongs to a different Instagram account. Review history.",
          lease,
        );
        return;
      }
      let token = await decryptToken(env, account.token_cipher);
      if (
        account.expires_at - Date.now() < 7 * 86400000 &&
        account.refreshed_at < Date.now() - 86400000
      ) {
        try {
          const refreshed = await adapter.refresh(token);
          token = refreshed.access_token;
          await lease.assert();
          await env.DB.prepare(
            `UPDATE accounts SET token_cipher=?,expires_at=?,refreshed_at=? WHERE id=1 AND ${lease.guard()}`,
          )
            .bind(
              await encryptToken(env, token),
              Date.now() + refreshed.expires_in * 1000,
              Date.now(),
            )
            .run();
        } catch (e) {
          if (e instanceof MetaError && e.code === 190) {
            await env.DB.prepare(
              `UPDATE accounts SET status='reauth_required' WHERE id=1 AND ${lease.guard()}`,
            ).run();
            await pause(env, e.message, lease);
            return;
          } /* transient refresh error: valid current token can still be used */
        }
      }
      if (!job) {
        const videos = (
          await env.DB.prepare(
            "SELECT * FROM videos ORDER BY position,id",
          ).all<Video>()
        ).results;
        const video = selectNext(videos, s, Date.now());
        if (!video) {
          const remaining = videos.filter(
            (v) =>
              v.enabled &&
              v.status === "ready" &&
              (s.mode === "loop" || v.publish_count === 0),
          );
          if (!remaining.length) {
            await pause(
              env,
              s.mode === "once"
                ? "Publish-once queue completed."
                : "No enabled, verified videos in the queue.",
              lease,
            );
          } else {
            const next = Math.min(
              ...remaining.map(
                (v) => (v.last_published_at ?? 0) + s.cooldown_minutes * 60000,
              ),
            );
            await env.DB.prepare(
              `UPDATE settings SET next_publish_at=? WHERE id=1 AND ${lease.guard()}`,
            )
              .bind(next)
              .run();
          }
          return;
        }
        const id = await createJob(
          env,
          lease,
          video,
          account,
          false,
          s.next_publish_at ?? Date.now(),
        );
        job = (await env.DB.prepare("SELECT * FROM jobs WHERE id=?")
          .bind(id)
          .first<Job>())!;
      }
      if (job.state === "publishing") {
        // A persisted publishing intent means the POST may already have succeeded. Never send it again.
        await change(env, lease, job, "uncertain", {
          error:
            "Publication response was interrupted. Verify Instagram and reconcile this job.",
        });
        await pause(
          env,
          "An uncertain publication requires owner review.",
          lease,
        );
        return;
      }
      if (job.media_expires_at <= Date.now()) {
        await fail(
          env,
          lease,
          job,
          "Unpublished job expired. Create a fresh job after review.",
        );
        return;
      }
      if (job.retry_at > Date.now()) return;
      if (!s.enabled && !job.manual) return; // Pause stops new container/publish operations; in-flight POST can still finish.
      let attemptedCreate = false;
      try {
        if (["queued", "creating"].includes(job.state)) {
          const quota = await adapter.quota(account.instagram_id, token);
          if (quota.used >= quota.total)
            throw new MetaError(429, true, false, 3600000);
          if (job.state === "queued")
            await change(env, lease, job, "creating", { attempts: 1 });
          else await change(env, lease, job, "creating", { attempts: 1 });
          attemptedCreate = true;
          const url = await mediaUrl(env, job.id, job.media_expires_at);
          const container = await adapter.createContainer(
            account.instagram_id,
            token,
            url,
            job.caption,
          );
          await change(env, lease, job, "processing", {
            container,
            retry: Date.now() + 60000,
          });
          return;
        }
        if (job.state === "processing") {
          const status = await adapter.status(job.container_id!, token);
          if (status === "IN_PROGRESS") {
            if (
              Date.now() - (job.processing_started_at ?? job.created_at) >
              3600000
            )
              await fail(
                env,
                lease,
                job,
                "Instagram processing exceeded one hour. Check video encoding.",
              );
            else
              await change(env, lease, job, "processing", {
                retry: Date.now() + 60000,
              });
            return;
          }
          if (status === "PUBLISHED") {
            await change(env, lease, job, "uncertain", {
              error:
                "Container is published; owner must reconcile the Instagram media ID.",
            });
            await pause(env, "Publication requires reconciliation.", lease);
            return;
          }
          if (status !== "FINISHED") {
            await fail(
              env,
              lease,
              job,
              `Instagram processing ended with ${["ERROR", "EXPIRED"].includes(status) ? status : "an unsupported status"}. Convert the video locally and try again.`,
            );
            return;
          }
          await change(env, lease, job, "ready");
          return;
        }
        if (job.state === "ready") {
          // Recheck pause immediately before persisting the single-use publishing intent.
          s = (await env.DB.prepare(
            "SELECT * FROM settings WHERE id=1",
          ).first<Settings>())!;
          if (!s.enabled && !job.manual) return;
          const quota = await adapter.quota(account.instagram_id, token);
          if (quota.used >= quota.total)
            throw new MetaError(429, true, false, 3600000);
          if (!(await change(env, lease, job, "publishing", { attempts: 1 })))
            return;
          let media: string;
          try {
            media = await adapter.publish(
              account.instagram_id,
              token,
              job.container_id!,
            );
          } catch (e) {
            // Even a provider error after submission is conservatively treated as uncertain.
            await change(env, lease, job, "uncertain", {
              error:
                e instanceof MetaError
                  ? `Publish outcome needs review. ${e.message}`
                  : "Publish outcome needs review.",
            });
            await pause(
              env,
              "An uncertain publication requires owner review.",
              lease,
            );
            return;
          }
          await complete(env, lease, job, media);
          return;
        }
      } catch (e) {
        if (e instanceof MetaError) {
          if (e.code === 190) {
            await env.DB.prepare(
              `UPDATE accounts SET status='reauth_required' WHERE id=1 AND ${lease.guard()}`,
            ).run();
            await pause(env, e.message, lease);
            await change(env, lease, job, job.state, {
              error: e.message,
              retry: Date.now() + 3600000,
            });
            return;
          }
          if (
            e.retryable &&
            job.attempts < 4 &&
            Date.now() < job.media_expires_at - 3600000
          ) {
            await change(env, lease, job, job.state, {
              error: e.message,
              retry: Date.now() + backoff(job.attempts || 1, e.retryAfter),
              attempts: attemptedCreate ? 0 : 1,
            });
            return;
          }
          await fail(env, lease, job, e.message);
          return;
        }
        throw e; // Unknown failures preserve the job. A publishing intent is reconciled next tick.
      }
    });
  } catch (e) {
    if (e instanceof BusyError) return;
    throw e;
  }
}
