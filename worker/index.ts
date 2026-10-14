import { bulk, requireCover } from "./bulk";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z, ZodError } from "zod";
import {
  ACTIVE,
  type Env,
  type Settings,
  type Video,
  type Job,
  type Account,
} from "./types";
import {
  getSession,
  passwordMatches,
  randomToken,
  sha256,
  safeEqual,
  rateLimit,
  requireOrigin,
  encryptToken,
  decryptToken,
  mediaSignature,
  coverSignature,
} from "./security";
import { BusyError, withLease } from "./lease";
import { Instagram, MetaError } from "./instagram";
import { atStage, OperationError } from "./diagnostics";
import { uploadSchema, settingsSchema, videoSchema } from "./validation";
import { upcoming } from "./queue";
import { tick, createJob, complete, event } from "./scheduler";
import {
  PART_SIZE,
  configured,
  uploadUrl,
  verifyUpload,
  serveObject,
  mediaJob,
  cleanup,
} from "./storage";
type Vars = { session: { csrf: string; hash: string; expires_at: number } };
export const app = new Hono<{ Bindings: Env; Variables: Vars }>();
app.use("*", async (c, next) => {
  const origin = new URL(c.env.APP_ORIGIN);
  const requested = new URL(c.req.url);
  if (origin.protocol === "https:" && requested.protocol !== "https:") {
    if (!["GET", "HEAD"].includes(c.req.method))
      return c.json({ error: "HTTPS is required for this request." }, 400);
    origin.pathname = requested.pathname;
    origin.search = requested.search;
    return c.redirect(origin.toString(), 308);
  }
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(origin.hostname)
  )
    throw new HTTPException(503, {
      message: "HTTPS is required for the dashboard.",
    });
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (c.req.path.startsWith("/api")) c.header("Cache-Control", "no-store");
  if (origin.protocol === "https:")
    c.header("Strict-Transport-Security", "max-age=31536000");
});
app.onError((err, c) => {
  if (err instanceof OperationError) {
    console.warn("operation_failed", JSON.stringify(err.diagnostic()));
    return c.json({ error: err.message, ...err.diagnostic() }, err.status);
  }
  if (err instanceof HTTPException)
    return c.json({ error: err.message }, err.status);
  if (err instanceof ZodError)
    return c.json({ error: err.issues.map((i) => i.message).join(" ") }, 400);
  if (err instanceof BusyError) return c.json({ error: err.message }, 409);
  if (err instanceof MetaError) return c.json({ error: err.message }, 502);
  if (err instanceof SyntaxError)
    return c.json({ error: "Invalid JSON request." }, 400);
  return c.json(
    {
      error:
        "Operation failed. Check configuration and try again. No success was recorded.",
    },
    500,
  );
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 32768,
    onError: (c) => c.json({ error: "Request is too large." }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  if (Number(c.req.header("Content-Length") || 0) > 32768)
    throw new HTTPException(413, { message: "Request is too large." });
  if (
    c.req.path === "/api/auth/login" ||
    c.req.path === "/api/instagram/callback"
  )
    return next();
  const session = await getSession(c.env, c.req.raw);
  if (!session)
    throw new HTTPException(401, {
      message: "Sign in to your owner dashboard.",
    });
  c.set("session", session);
  if (!["GET", "HEAD"].includes(c.req.method)) {
    requireOrigin(c.env, c.req.raw);
    if (!safeEqual(c.req.header("X-CSRF-Token") || "", session.csrf))
      throw new HTTPException(403, {
        message: "Session verification failed. Refresh and try again.",
      });
    await rateLimit(c.env, `admin:${session.hash}`, 120);
  }
  await next();
});
app.route("/api", bulk);
app.post("/api/auth/login", async (c) => {
  requireOrigin(c.env, c.req.raw);
  await rateLimit(c.env, "login:global", 20, 900000);
  await rateLimit(
    c.env,
    `login:${c.req.header("CF-Connecting-IP") || "local"}`,
    5,
    900000,
  );
  const { password } = z
    .object({ password: z.string().min(1).max(256) })
    .parse(await c.req.json());
  if (!c.env.OWNER_PASSWORD_HASH)
    throw new HTTPException(503, {
      message: "Set OWNER_PASSWORD_HASH to enable the secure dashboard.",
    });
  if (!(await passwordMatches(password, c.env.OWNER_PASSWORD_HASH)))
    throw new HTTPException(401, { message: "Incorrect owner password." });
  const token = randomToken(),
    csrf = randomToken();
  await c.env.DB.prepare(
    "INSERT INTO sessions(id_hash,csrf,expires_at) VALUES(?,?,?)",
  )
    .bind(await sha256(token), csrf, Date.now() + 12 * 3600000)
    .run();
  c.header(
    "Set-Cookie",
    `reelloop_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${c.env.APP_ORIGIN.startsWith("https:") ? "; Secure" : ""}`,
  );
  return c.json({ csrf });
});
app.get("/api/auth/session", (c) => c.json({ csrf: c.get("session").csrf }));
app.post("/api/auth/logout", async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash=?")
    .bind(c.get("session").hash)
    .run();
  c.header(
    "Set-Cookie",
    "reelloop_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" +
      (c.env.APP_ORIGIN.startsWith("https:") ? "; Secure" : ""),
  );
  return c.json({ ok: true });
});
app.get("/api/dashboard", async (c) => {
  const result = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM settings WHERE id=1"),
    c.env.DB.prepare(
      "SELECT instagram_id,username,expires_at,status FROM accounts WHERE id=1",
    ),
    c.env.DB.prepare("SELECT * FROM videos ORDER BY position,id"),
    c.env.DB.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100"),
    c.env.DB.prepare(
      "SELECT COUNT(*) total, SUM(CASE WHEN state='succeeded' THEN 1 ELSE 0 END) success, SUM(CASE WHEN state IN('failed','uncertain') THEN 1 ELSE 0 END) errors FROM jobs",
    ),
    c.env.DB.prepare("SELECT COALESCE(SUM(size_bytes),0) bytes FROM covers"),
  ]);
  const settings = result[0].results[0] as unknown as Settings;
  const { lease_token, lease_until, ...publicSettings } = settings;
  void lease_token;
  void lease_until;
  const videos = result[2].results as unknown as Video[];
  return c.json({
    settings: publicSettings,
    account: result[1].results[0] ?? null,
    videos: videos.map(({ object_key, multipart_id, ...v }) => {
      void object_key;
      void multipart_id;
      return v;
    }),
    jobs: (result[3].results as unknown as Job[]).map(
      ({ object_key, media_expires_at, ...j }) => {
        void object_key;
        void media_expires_at;
        return j;
      },
    ),
    stats: result[4].results[0],
    storage: {
      used:
        videos.reduce((n, v) => n + v.size_bytes, 0) +
        Number((result[5].results[0] as { bytes: number })?.bytes ?? 0),
      limit: Number(c.env.MAX_STORAGE_BYTES) || 10737418240,
    },
    upcoming: upcoming(videos, settings, Date.now()),
    configuration: {
      uploads: configured(c.env),
      instagram: Boolean(
        c.env.META_APP_ID &&
        c.env.META_APP_SECRET &&
        c.env.TOKEN_ENCRYPTION_KEY &&
        c.env.MEDIA_SIGNING_KEY,
      ),
    },
  });
});
app.patch("/api/settings", async (c) => {
  const s = settingsSchema.parse(await c.req.json());
  await withLease(c.env, async (lease) => {
    await c.env.DB.prepare(
      `UPDATE settings SET interval_minutes=?,timezone=?,mode=?,cooldown_minutes=? WHERE id=1 AND ${lease.guard()}`,
    )
      .bind(s.interval_minutes, s.timezone, s.mode, s.cooldown_minutes)
      .run();
  });
  return c.json({ ok: true });
});
app.post("/api/schedule/pause", async (c) => {
  await c.env.DB.prepare(
    "UPDATE settings SET enabled=0,pause_reason='Paused by owner.' WHERE id=1",
  ).run();
  return c.json({ ok: true });
});
app.post("/api/schedule/start", async (c) => {
  const { start_at } = z
    .object({
      start_at: z
        .number()
        .int()
        .min(Date.now() - 60000)
        .max(Date.now() + 365 * 86400000)
        .optional(),
    })
    .parse(await c.req.json());
  await withLease(c.env, async (lease) => {
    const account = await c.env.DB.prepare(
      "SELECT * FROM accounts WHERE id=1 AND status='connected' AND expires_at>?",
    )
      .bind(Date.now())
      .first();
    if (!account)
      throw new HTTPException(409, {
        message: "Connect an authorized Instagram account first.",
      });
    if (
      !configured(c.env) ||
      !c.env.MEDIA_SIGNING_KEY ||
      !c.env.TOKEN_ENCRYPTION_KEY ||
      !c.env.PUBLIC_ORIGIN.startsWith("https://")
    )
      throw new HTTPException(409, {
        message:
          "Configure R2, encrypted tokens, and a public HTTPS media origin first.",
      });
    const uncertain = await c.env.DB.prepare(
      "SELECT id FROM jobs WHERE state IN('uncertain','publishing')",
    ).first();
    if (uncertain)
      throw new HTTPException(409, {
        message: "Reconcile the uncertain publication before resuming.",
      });
    const s = (await c.env.DB.prepare(
      "SELECT * FROM settings WHERE id=1",
    ).first<Settings>())!;
    const videos = (
      await c.env.DB.prepare(
        "SELECT * FROM videos WHERE status='ready' AND enabled=1",
      ).all<Video>()
    ).results;
    if (!videos.some((v) => s.mode === "loop" || v.publish_count === 0))
      throw new HTTPException(409, {
        message: "Add an enabled verified video to the queue.",
      });
    await c.env.DB.prepare(
      `UPDATE settings SET enabled=1,next_publish_at=?,failure_streak=0,pause_reason=NULL WHERE id=1 AND ${lease.guard()}`,
    )
      .bind(start_at ?? Math.max(Date.now(), s.next_publish_at ?? 0))
      .run();
  });
  return c.json({ ok: true });
});
app.post("/api/instagram/connect", async (c) => {
  if (
    !c.env.META_APP_ID ||
    !c.env.META_APP_SECRET ||
    !c.env.TOKEN_ENCRYPTION_KEY ||
    !c.env.PUBLIC_ORIGIN.startsWith("https://")
  )
    throw new HTTPException(503, {
      message:
        "Configure Instagram Login credentials and the public HTTPS callback URL first.",
    });
  const state = randomToken();
  await c.env.DB.prepare(
    "INSERT INTO oauth_states(state_hash,session_hash,expires_at) VALUES(?,?,?)",
  )
    .bind(await sha256(state), c.get("session").hash, Date.now() + 600000)
    .run();
  const url = new URL("https://www.instagram.com/oauth/authorize");
  Object.entries({
    client_id: c.env.META_APP_ID,
    redirect_uri: `${c.env.PUBLIC_ORIGIN}/api/instagram/callback`,
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_content_publish",
    state,
    enable_fb_login: "0",
    force_authentication: "1",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  return c.json({ url: url.toString() });
});
app.get("/api/instagram/callback", async (c) => {
  const session = await atStage("oauth_session", () =>
    getSession(c.env, c.req.raw),
  );
  if (!session) throw new OperationError("oauth_session", 401);
  const state = c.req.query("state");
  if (!state) throw new OperationError("oauth_state", 400);
  const row = await atStage("oauth_state", async () =>
    c.env.DB.prepare(
      "DELETE FROM oauth_states WHERE state_hash=? AND session_hash=? AND expires_at>? RETURNING state_hash",
    )
      .bind(await sha256(state), session.hash, Date.now())
      .first(),
  );
  if (!row) throw new OperationError("oauth_state", 403);
  if (c.req.query("error"))
    return c.redirect(`${c.env.APP_ORIGIN}/?connection=denied`);
  const code = c.req.query("code");
  if (!code) throw new OperationError("oauth_code", 400);
  await atStage("oauth_persistence", () =>
    withLease(c.env, async (lease) => {
      if (
        await c.env.DB.prepare(
          `SELECT id FROM jobs WHERE state IN(${ACTIVE})`,
        ).first()
      )
        throw new HTTPException(409, {
          message: "Resolve or cancel the active job before reconnecting.",
        });
      const data = await new Instagram(c.env).exchange(code);
      const cipher = await atStage("oauth_encryption", () =>
        encryptToken(c.env, data.access_token),
      );
      await lease.assert();
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO accounts(id,instagram_id,username,token_cipher,expires_at,refreshed_at,status) SELECT 1,?,?,?,?,?,? WHERE ${lease.guard()} ON CONFLICT(id) DO UPDATE SET instagram_id=excluded.instagram_id,username=excluded.username,token_cipher=excluded.token_cipher,expires_at=excluded.expires_at,refreshed_at=excluded.refreshed_at,status=excluded.status`,
        ).bind(
          data.id,
          data.username,
          cipher,
          Date.now() + data.expires_in * 1000,
          Date.now(),
          "connected",
        ),
        c.env.DB.prepare(
          `UPDATE settings SET enabled=0,pause_reason='Account connected. Enable the schedule when ready.' WHERE id=1 AND ${lease.guard()}`,
        ),
      ]);
      await lease.assert();
    }),
  );
  return c.redirect(`${c.env.APP_ORIGIN}/?connection=success`);
});
app.post("/api/instagram/disconnect", async (c) => {
  await withLease(c.env, async () => {
    if (
      await c.env.DB.prepare(
        `SELECT id FROM jobs WHERE state IN(${ACTIVE})`,
      ).first()
    )
      throw new HTTPException(409, {
        message: "Resolve or cancel the active job first.",
      });
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM accounts"),
      c.env.DB.prepare(
        "UPDATE settings SET enabled=0,pause_reason='Instagram disconnected.' WHERE id=1",
      ),
    ]);
  });
  return c.json({ ok: true });
});
app.post("/api/uploads", async (c) => {
  const input = uploadSchema.parse(await c.req.json());
  if (!configured(c.env))
    throw new HTTPException(503, {
      message:
        "R2 direct uploads require server credentials and bucket CORS configuration.",
    });
  const result = await withLease(c.env, async () => {
    const usage = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(size_bytes),0)+(SELECT COALESCE(SUM(size_bytes),0) FROM covers) bytes,COUNT(*) total FROM videos",
    ).first<{ bytes: number; total: number }>();
    if (
      (usage?.bytes ?? 0) + input.size_bytes >
      (Number(c.env.MAX_STORAGE_BYTES) || 10737418240)
    )
      throw new HTTPException(413, {
        message: "Storage quota reached. Delete videos or increase your quota.",
      });
    if ((usage?.total ?? 0) >= 500)
      throw new HTTPException(413, {
        message: "Maximum 500 stored and pending videos.",
      });
    const id = crypto.randomUUID();
    const multi =
      input.size_bytes > 32 * 1024 * 1024
        ? await c.env.VIDEOS.createMultipartUpload(`staging/${id}`, {
            httpMetadata: { contentType: input.content_type },
          })
        : null;
    try {
      await c.env.DB.prepare(
        "INSERT INTO videos(id,object_key,name,content_type,size_bytes,duration_seconds,width,height,position,multipart_id,created_at,caption,cover_id) VALUES(?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM videos),?,?,(SELECT default_caption FROM settings WHERE id=1),(SELECT default_cover_id FROM settings WHERE id=1))",
      )
        .bind(
          id,
          `staging/${id}`,
          input.name,
          input.content_type,
          input.size_bytes,
          input.duration_seconds,
          input.width,
          input.height,
          multi?.uploadId ?? null,
          Date.now(),
        )
        .run();
    } catch (e) {
      if (multi) await multi.abort();
      throw e;
    }
    const v = (await c.env.DB.prepare("SELECT * FROM videos WHERE id=?")
      .bind(id)
      .first<Video>())!;
    return {
      id,
      multipart: Boolean(multi),
      part_size: PART_SIZE,
      parts: Math.ceil(input.size_bytes / PART_SIZE),
      url: multi ? undefined : await uploadUrl(c.env, v),
    };
  });
  return c.json(result, 201);
});
app.post("/api/uploads/:id/part", async (c) => {
  const { part } = z
    .object({ part: z.number().int().min(1).max(10000) })
    .parse(await c.req.json());
  const v = await c.env.DB.prepare(
    "SELECT * FROM videos WHERE id=? AND status='uploading'",
  )
    .bind(c.req.param("id"))
    .first<Video>();
  if (!v || !v.multipart_id || part > Math.ceil(v.size_bytes / PART_SIZE))
    throw new HTTPException(400, { message: "Invalid multipart upload." });
  return c.json({ url: await uploadUrl(c.env, v, part) });
});
app.post("/api/uploads/:id/complete", async (c) => {
  const { parts } = z
    .object({
      parts: z
        .array(
          z.object({
            partNumber: z.number().int().min(1),
            etag: z.string().min(1).max(256),
          }),
        )
        .max(10000)
        .optional(),
    })
    .parse(await c.req.json());
  await atStage("upload_persistence", () =>
    withLease(c.env, async (lease) => {
      const v = await c.env.DB.prepare("SELECT * FROM videos WHERE id=?")
        .bind(c.req.param("id"))
        .first<Video>();
      if (!v) throw new HTTPException(404, { message: "Upload not found." });
      if (v.status === "ready") return;
      if (v.status !== "uploading")
        throw new HTTPException(409, { message: "Upload is being deleted." });
      await atStage("upload_multipart", async () => {
        if (v.multipart_id) {
          const head = await c.env.VIDEOS.head(`staging/${v.id}`);
          if (!head) {
            if (
              !parts ||
              parts.length !== Math.ceil(v.size_bytes / PART_SIZE) ||
              parts.some((p, i) => p.partNumber !== i + 1)
            )
              throw new HTTPException(400, {
                message: "Provide every uploaded part in order.",
              });
            await c.env.VIDEOS.resumeMultipartUpload(
              `staging/${v.id}`,
              v.multipart_id,
            ).complete(
              parts.map((p) => ({ ...p, etag: p.etag.replace(/^"|"$/g, "") })),
            );
          }
        }
      });
      await verifyUpload(c.env, v, undefined, lease);
    }),
  );
  return c.json({ ok: true });
});
app.delete("/api/uploads/:id", async (c) => {
  await withLease(c.env, async () => {
    const v = await c.env.DB.prepare(
      "SELECT * FROM videos WHERE id=? AND status='uploading'",
    )
      .bind(c.req.param("id"))
      .first<Video>();
    if (!v)
      throw new HTTPException(404, { message: "Pending upload not found." });
    if (v.multipart_id && !(await c.env.VIDEOS.head(`staging/${v.id}`)))
      await c.env.VIDEOS.resumeMultipartUpload(
        `staging/${v.id}`,
        v.multipart_id,
      ).abort();
    await c.env.VIDEOS.delete([`staging/${v.id}`, `videos/${v.id}`]);
    await c.env.DB.prepare("DELETE FROM videos WHERE id=?").bind(v.id).run();
  });
  return c.json({ ok: true });
});
app.patch("/api/videos/:id", async (c) => {
  const v = videoSchema.parse(await c.req.json());
  await withLease(c.env, async (lease) => {
    const old = await c.env.DB.prepare(
      "SELECT * FROM videos WHERE id=? AND status='ready'",
    )
      .bind(c.req.param("id"))
      .first<Video>();
    if (!old)
      throw new HTTPException(404, { message: "Verified video not found." });
    const settings = (await c.env.DB.prepare(
      "SELECT * FROM settings WHERE id=1",
    ).first<Settings>())!;
    const caption =
      v.caption_mode === "default" ? settings.default_caption : v.caption;
    const hashtags = v.caption_mode === "default" ? "" : v.hashtags;
    const override =
      v.caption_mode === "default"
        ? 0
        : v.caption_mode === "override" ||
            caption !== old.caption ||
            hashtags !== old.hashtags
          ? 1
          : old.caption_override;
    await c.env.DB.prepare(
      `UPDATE videos SET name=?,caption=?,hashtags=?,caption_override=?,enabled=? WHERE id=? AND status='ready' AND ${lease.guard()}`,
    )
      .bind(v.name, caption, hashtags, override, v.enabled ? 1 : 0, old.id)
      .run();
  });
  return c.json({ ok: true });
});
app.post("/api/videos/reorder", async (c) => {
  const { ids } = z
    .object({ ids: z.array(z.string()).max(500) })
    .parse(await c.req.json());
  await withLease(c.env, async () => {
    const videos = (
      await c.env.DB.prepare("SELECT id FROM videos WHERE status='ready'").all<{
        id: string;
      }>()
    ).results;
    if (
      ids.length !== videos.length ||
      new Set(ids).size !== ids.length ||
      videos.some((v) => !ids.includes(v.id))
    )
      throw new HTTPException(409, {
        message: "Library changed. Refresh before reordering.",
      });
    if (ids.length)
      await c.env.DB.batch(
        ids.map((id, i) =>
          c.env.DB.prepare("UPDATE videos SET position=? WHERE id=?").bind(
            i,
            id,
          ),
        ),
      );
  });
  return c.json({ ok: true });
});
app.delete("/api/videos/:id", async (c) => {
  await withLease(c.env, async () => {
    const id = c.req.param("id");
    const v = await c.env.DB.prepare(
      "SELECT * FROM videos WHERE id=? AND status='ready'",
    )
      .bind(id)
      .first<Video>();
    if (!v) throw new HTTPException(404, { message: "Video not found." });
    if (
      await c.env.DB.prepare(
        `SELECT id FROM jobs WHERE video_id=? AND state IN(${ACTIVE})`,
      )
        .bind(id)
        .first()
    )
      throw new HTTPException(409, {
        message:
          "Video is part of an active job. Pause and cancel or reconcile the job first.",
      });
    await c.env.DB.prepare(
      "UPDATE videos SET status='deleting',enabled=0 WHERE id=?",
    )
      .bind(id)
      .run();
    await c.env.VIDEOS.delete(v.object_key);
    await c.env.DB.prepare("DELETE FROM videos WHERE id=?").bind(id).run();
  });
  return c.json({ ok: true });
});
app.on(["GET", "HEAD"], "/api/videos/:id/preview", async (c) => {
  const v = await c.env.DB.prepare(
    "SELECT * FROM videos WHERE id=? AND status='ready'",
  )
    .bind(c.req.param("id"))
    .first<Video>();
  if (!v) throw new HTTPException(404, { message: "Video not found." });
  return serveObject(c.env, c.req.raw, v.object_key, v.content_type);
});
app.post("/api/publish/test", async (c) => {
  const input = z
    .object({
      video_id: z.string(),
      confirmation: z.literal("PUBLISH ONE REEL"),
    })
    .parse(await c.req.json());
  const id = await withLease(c.env, async (lease) => {
    const s = (await c.env.DB.prepare(
      "SELECT * FROM settings WHERE id=1",
    ).first<Settings>())!;
    if (s.enabled)
      throw new HTTPException(409, {
        message: "Pause automation before a manual test.",
      });
    if (!c.env.PUBLIC_ORIGIN.startsWith("https://") || !c.env.MEDIA_SIGNING_KEY)
      throw new HTTPException(409, {
        message: "A configured public HTTPS media endpoint is required.",
      });
    const account = await c.env.DB.prepare(
      "SELECT * FROM accounts WHERE id=1 AND status='connected' AND expires_at>?",
    )
      .bind(Date.now())
      .first<Account>();
    if (!account)
      throw new HTTPException(409, {
        message: "Connect a valid Instagram account first.",
      });
    if (
      await c.env.DB.prepare(
        `SELECT id FROM jobs WHERE state IN(${ACTIVE})`,
      ).first()
    )
      throw new HTTPException(409, {
        message:
          "Another job is active. Wait, cancel it, or reconcile its result.",
      });
    const v = await c.env.DB.prepare(
      "SELECT * FROM videos WHERE id=? AND status='ready' AND enabled=1",
    )
      .bind(input.video_id)
      .first<Video>();
    if (!v)
      throw new HTTPException(409, {
        message: "Choose an enabled, verified video.",
      });
    if (
      v.last_published_at !== null &&
      v.last_published_at + s.cooldown_minutes * 60000 > Date.now()
    )
      throw new HTTPException(409, {
        message: "Repeat cooldown is still active for this video.",
      });
    return createJob(c.env, lease, v, account, true, Date.now());
  });
  return c.json({ id, state: "queued" }, 202);
});
app.get("/api/jobs/:id/events", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT * FROM job_events WHERE job_id=? ORDER BY at,id",
      )
        .bind(c.req.param("id"))
        .all()
    ).results,
  ),
);
app.get("/api/instagram/recent", async (c) => {
  const a = await c.env.DB.prepare(
    "SELECT * FROM accounts WHERE id=1",
  ).first<Account>();
  if (!a) throw new HTTPException(409, { message: "Connect Instagram first." });
  return c.json(
    await new Instagram(c.env).media(
      a.instagram_id,
      await decryptToken(c.env, a.token_cipher),
    ),
  );
});
app.post("/api/jobs/:id/reconcile", async (c) => {
  const data = z
    .object({
      media_id: z.string().regex(/^\d+$/),
      confirmation: z.literal("I VERIFIED THIS REEL"),
    })
    .parse(await c.req.json());
  await withLease(c.env, async (lease) => {
    const job = await c.env.DB.prepare(
      "SELECT * FROM jobs WHERE id=? AND state IN('uncertain','publishing')",
    )
      .bind(c.req.param("id"))
      .first<Job>();
    const a = await c.env.DB.prepare(
      "SELECT * FROM accounts WHERE id=1",
    ).first<Account>();
    if (!job || !a || job.account_id !== a.instagram_id)
      throw new HTTPException(409, { message: "No matching uncertain job." });
    const recent = await new Instagram(c.env).media(
      a.instagram_id,
      await decryptToken(c.env, a.token_cipher),
    );
    const media = recent.find((m) => m.id === data.media_id);
    if (
      !media ||
      !Number.isFinite(Date.parse(media.timestamp)) ||
      Date.parse(media.timestamp) < job.created_at - 60000
    )
      throw new HTTPException(400, {
        message:
          "Media ID is not a recent post belonging to the connected account.",
      });
    if (
      await c.env.DB.prepare(
        "SELECT id FROM jobs WHERE media_id=? AND state='succeeded'",
      )
        .bind(data.media_id)
        .first()
    )
      throw new HTTPException(409, {
        message: "Media ID already belongs to another successful job.",
      });
    await complete(c.env, lease, job, media.id, Date.parse(media.timestamp));
  });
  return c.json({ ok: true });
});
app.post("/api/jobs/:id/cancel", async (c) => {
  const { confirmation } = z
    .object({
      confirmation: z.enum([
        "CANCEL UNPUBLISHED JOB",
        "I VERIFIED NO REEL WAS PUBLISHED",
      ]),
    })
    .parse(await c.req.json());
  await withLease(c.env, async () => {
    const job = await c.env.DB.prepare(
      `SELECT * FROM jobs WHERE id=? AND state IN(${ACTIVE})`,
    )
      .bind(c.req.param("id"))
      .first<Job>();
    if (!job) throw new HTTPException(409, { message: "No active job." });
    if (
      ["uncertain", "publishing"].includes(job.state) &&
      confirmation !== "I VERIFIED NO REEL WAS PUBLISHED"
    )
      throw new HTTPException(409, {
        message:
          "Verify the Instagram profile before abandoning an uncertain job.",
      });
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE jobs SET state='skipped',error='Cancelled after owner review.' WHERE id=?",
      ).bind(job.id),
      c.env.DB.prepare(
        "UPDATE settings SET enabled=0,pause_reason='Job cancelled by owner. Resume when ready.',next_publish_at=? + interval_minutes*60000 WHERE id=1",
      ).bind(Date.now()),
    ]);
    await event(c.env, job.id, "skipped", confirmation);
  });
  return c.json({ ok: true });
});
app.on(["GET", "HEAD"], "/media/:id", async (c) => {
  const expires = Number(c.req.query("expires"));
  const sig = c.req.query("sig") ?? "";
  if (
    !Number.isSafeInteger(expires) ||
    expires <= Date.now() ||
    !safeEqual(sig, await mediaSignature(c.env, c.req.param("id"), expires))
  )
    throw new HTTPException(403, {
      message: "Media link is invalid or expired.",
    });
  const job = await mediaJob(c.env, c.req.param("id"));
  if (
    !job ||
    job.media_expires_at !== expires ||
    ["failed", "skipped"].includes(job.state)
  )
    throw new HTTPException(404, { message: "Media not found." });
  const v = await c.env.DB.prepare(
    "SELECT content_type FROM videos WHERE object_key=? AND status='ready'",
  )
    .bind(job.object_key)
    .first<{ content_type: string }>();
  if (!v)
    throw new HTTPException(404, { message: "Media no longer available." });
  return serveObject(c.env, c.req.raw, job.object_key, v.content_type);
});
app.on(["GET", "HEAD"], "/cover-media/:id", async (c) => {
  const id = c.req.param("id"),
    expires = Number(c.req.query("expires"));
  if (
    !Number.isSafeInteger(expires) ||
    expires <= Date.now() ||
    !safeEqual(
      c.req.query("sig") ?? "",
      await coverSignature(c.env, id, expires),
    )
  )
    throw new HTTPException(403, {
      message: "Cover link is invalid or expired.",
    });
  const job = await mediaJob(c.env, id);
  if (
    !job ||
    !job.cover_id ||
    job.media_expires_at !== expires ||
    ["failed", "skipped"].includes(job.state)
  )
    throw new HTTPException(404, { message: "Cover is unavailable." });
  const cover = await requireCover(c.env, job.cover_id);
  return serveObject(c.env, c.req.raw, cover!.object_key, "image/jpeg");
});
app.all("/api/*", (c) => c.json({ error: "Endpoint not found." }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
export default {
  fetch: app.fetch,
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        try {
          await tick(env);
        } catch {
          // Only a fixed diagnostic is persisted; provider URLs/tokens are never logged.
          await env.DB.prepare(
            "UPDATE settings SET enabled=0,pause_reason='Scheduler interrupted. Review active jobs and configuration before resuming.' WHERE id=1 AND lease_until<=?",
          )
            .bind(Date.now())
            .run();
          const job = await env.DB.prepare(
            `SELECT id FROM jobs WHERE state IN(${ACTIVE}) LIMIT 1`,
          ).first<{ id: string }>();
          if (job)
            await event(
              env,
              job.id,
              "interrupted",
              "Scheduler interrupted; persisted state is retained for recovery.",
            );
        }
        if (new Date(controller.scheduledTime).getUTCMinutes() === 0) {
          try {
            await withLease(env, () => cleanup(env));
          } catch {
            /* Cleanup safely retries next hour. */
          }
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
