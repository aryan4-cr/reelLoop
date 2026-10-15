import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Cover, Env, Settings, Video } from "./types";
import { withLease } from "./lease";
import { captionText } from "./validation";
import { coverUploadUrl, serveObject } from "./storage";
const bad = (message: string) => new HTTPException(400, { message });
export const MAX_COVER_BYTES = 2_000_000;

// Bounded structural validation, independent of browser-supplied dimensions/MIME.
// Full image decoding and JPEG re-encoding happen in the browser before upload.
export function jpegDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 20 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  )
    throw bad("Use a complete JPEG image.");
  let pos = 2,
    width = 0,
    height = 0,
    quantization = false;
  const word = (p: number) => bytes[p] * 256 + bytes[p + 1];
  while (pos + 4 < Math.min(bytes.length, 65536)) {
    if (bytes[pos++] !== 255) throw bad("Invalid JPEG structure.");
    while (bytes[pos] === 255) pos++;
    const marker = bytes[pos++],
      length = word(pos);
    if (length < 2 || pos + length > bytes.length)
      throw bad("Incomplete JPEG image.");
    if (marker === 219) quantization = true;
    if ([192, 194].includes(marker)) {
      if (length < 11 || bytes[pos + 2] !== 8 || bytes[pos + 7] !== 3)
        throw bad("Use an 8-bit RGB JPEG cover.");
      height = word(pos + 3);
      width = word(pos + 5);
    }
    if (marker === 218) {
      if (
        !quantization ||
        width < 320 ||
        width > 1920 ||
        height < 320 ||
        height > 3840 ||
        width * height > 7372800
      )
        throw bad(
          "Cover must be 320–1920 pixels wide and 320–3840 pixels high. Recommended: 1080 × 1920.",
        );
      if (pos + length >= bytes.length - 2)
        throw bad("JPEG image data is missing.");
      return { width, height };
    }
    pos += length;
  }
  throw bad("JPEG headers are invalid or too large. Export a fresh JPEG.");
}
export async function requireCover(env: Env, id: string | null) {
  if (!id) return null;
  const cover = await env.DB.prepare(
    "SELECT * FROM covers WHERE id=? AND status='ready'",
  )
    .bind(id)
    .first<Cover>();
  if (!cover || !(await env.VIDEOS.head(cover.object_key)))
    throw new HTTPException(409, {
      message:
        "Cover image is unavailable. Choose another cover or a video frame.",
    });
  return cover;
}
export const bulk = new Hono<{ Bindings: Env }>();
bulk.get("/covers", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id,name,size_bytes,width,height,status,created_at FROM covers ORDER BY created_at DESC",
  ).all();
  return c.json(rows.results);
});
bulk.post("/covers", async (c) => {
  const input = z
    .object({
      name: z.string().trim().min(1).max(160),
      size_bytes: z.number().int().positive().max(MAX_COVER_BYTES),
    })
    .parse(await c.req.json());
  const result = await withLease(c.env, async (lease) => {
    const usage = await c.env.DB.prepare(
      "SELECT (SELECT COALESCE(SUM(size_bytes),0) FROM videos)+(SELECT COALESCE(SUM(size_bytes),0) FROM covers) bytes,(SELECT COUNT(*) FROM covers) total",
    ).first<{ bytes: number; total: number }>();
    if (
      usage!.total >= 200 ||
      usage!.bytes + input.size_bytes >
        Number(c.env.MAX_STORAGE_BYTES || 8000000000)
    )
      throw new HTTPException(413, {
        message:
          "Storage or 200-cover limit reached. Remove unused covers first.",
      });
    const id = crypto.randomUUID();
    // Signing first avoids leaving a reservation if credentials are unavailable.
    const url = await coverUploadUrl(c.env, id);
    await c.env.DB.prepare(
      `INSERT INTO covers(id,object_key,name,size_bytes,width,height,created_at) SELECT ?,?,?,?,0,0,? WHERE ${lease.guard()}`,
    )
      .bind(
        id,
        `staging/covers/${id}`,
        input.name,
        input.size_bytes,
        Date.now(),
      )
      .run();
    return { id, url };
  });
  return c.json(result, 201);
});
bulk.post("/covers/:id/complete", async (c) => {
  const result = await withLease(c.env, async (lease) => {
    const row = await c.env.DB.prepare("SELECT * FROM covers WHERE id=?")
      .bind(c.req.param("id"))
      .first<Cover>();
    if (!row)
      throw new HTTPException(404, { message: "Cover upload not found." });
    if (row.status === "ready") return { id: row.id };
    if (row.status !== "uploading")
      throw new HTTPException(409, { message: "Cover deletion is pending." });
    const staging = `staging/covers/${row.id}`;
    const head = await c.env.VIDEOS.head(staging);
    if (
      !head ||
      head.size !== row.size_bytes ||
      head.size > MAX_COVER_BYTES ||
      head.httpMetadata?.contentType !== "image/jpeg"
    )
      throw bad("Cover upload is incomplete or is not JPEG. Retry the upload.");
    const object = await c.env.VIDEOS.get(staging, {
      onlyIf: { etagMatches: head.etag },
    });
    if (!object || !("body" in object))
      throw bad("Cover changed during verification. Retry.");
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    const dimensions = jpegDimensions(bytes);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const existing = await c.env.DB.prepare(
      "SELECT id,object_key FROM covers WHERE sha256=? AND status='ready'",
    )
      .bind(sha)
      .first<Cover>();
    await lease.assert();
    if (existing) {
      if (!(await c.env.VIDEOS.head(existing.object_key)))
        throw bad(
          "The matching saved cover is missing. Remove its references and replace it.",
        );
      await c.env.VIDEOS.delete(staging);
      await c.env.DB.prepare(
        `DELETE FROM covers WHERE id=? AND status='uploading' AND ${lease.guard()}`,
      )
        .bind(row.id)
        .run();
      return { id: existing.id };
    }
    const key = `covers/${sha}.jpg`;
    await c.env.DB.prepare(
      `UPDATE covers SET object_key=? WHERE id=? AND status='uploading' AND ${lease.guard()}`,
    )
      .bind(key, row.id)
      .run();
    await c.env.VIDEOS.put(key, bytes, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await lease.assert();
    const saved = await c.env.DB.prepare(
      `UPDATE covers SET object_key=?,sha256=?,width=?,height=?,status='ready' WHERE id=? AND status='uploading' AND ${lease.guard()} RETURNING id`,
    )
      .bind(key, sha, dimensions.width, dimensions.height, row.id)
      .first();
    if (!saved)
      throw new HTTPException(409, {
        message: "Cover finalization interrupted. Retry.",
      });
    try {
      await c.env.VIDEOS.delete(staging);
    } catch {
      /* Existing staging lifecycle handles cleanup. */
    }
    return { id: row.id };
  });
  return c.json(result);
});
bulk.on(["GET", "HEAD"], "/covers/:id/preview", async (c) => {
  const cover = await requireCover(c.env, c.req.param("id"));
  return serveObject(c.env, c.req.raw, cover!.object_key, "image/jpeg");
});
bulk.delete("/covers/:id", async (c) => {
  await withLease(c.env, async (lease) => {
    const id = c.req.param("id");
    const refs = await c.env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM settings WHERE default_cover_id=?)+(SELECT COUNT(*) FROM videos WHERE cover_id=?)+(SELECT COUNT(*) FROM jobs WHERE cover_id=?)+(SELECT COUNT(*) FROM batch_items WHERE cover_id=?) total",
    )
      .bind(id, id, id, id)
      .first<{ total: number }>();
    if (refs!.total)
      throw new HTTPException(409, {
        message:
          "This shared cover is referenced by defaults, videos or publishing history. It cannot be deleted.",
      });
    const row = await c.env.DB.prepare(
      `UPDATE covers SET status='deleting' WHERE id=? AND ${lease.guard()} RETURNING object_key`,
    )
      .bind(id)
      .first<Cover>();
    if (!row) throw new HTTPException(404, { message: "Cover not found." });
    await c.env.VIDEOS.delete([row.object_key, `staging/covers/${id}`]);
    await c.env.DB.prepare(
      `DELETE FROM covers WHERE id=? AND status='deleting' AND ${lease.guard()}`,
    )
      .bind(id)
      .run();
  });
  return c.json({ ok: true });
});
bulk.patch("/bulk/defaults", async (c) => {
  const input = z
    .object({
      caption: captionText.optional(),
      cover_id: z.string().uuid().nullable().optional(),
    })
    .refine((v) => v.caption !== undefined || v.cover_id !== undefined)
    .parse(await c.req.json());
  await withLease(c.env, async (lease) => {
    if (input.cover_id !== undefined) await requireCover(c.env, input.cover_id);
    const statements = [];
    if (input.caption !== undefined)
      statements.push(
        c.env.DB.prepare(
          `UPDATE settings SET default_caption=? WHERE id=1 AND ${lease.guard()}`,
        ).bind(input.caption),
      );
    if (input.cover_id !== undefined)
      statements.push(
        c.env.DB.prepare(
          `UPDATE settings SET default_cover_id=? WHERE id=1 AND ${lease.guard()}`,
        ).bind(input.cover_id),
      );
    await c.env.DB.batch(statements);
  });
  return c.json({ ok: true });
});
bulk.post("/bulk/apply", async (c) => {
  const input = z
    .object({
      ids: z.array(z.string().min(1).max(80)).min(1).max(500).optional(),
      caption: z.enum(["default", "replace"]).optional(),
      text: captionText.optional(),
      cover: z.literal("default").optional(),
      overwrite: z.boolean().default(false),
      confirm: z.boolean().default(false),
    })
    .refine((v) => v.caption || v.cover, "Choose caption or cover settings.")
    .parse(await c.req.json());
  if ((input.overwrite || input.caption === "replace") && !input.confirm)
    throw bad("Confirm overwriting existing settings first.");
  if (input.caption === "replace" && input.text === undefined)
    throw bad("Enter the replacement caption.");
  const result = await withLease(c.env, async (lease) => {
    const settings = (await c.env.DB.prepare(
      "SELECT * FROM settings WHERE id=1",
    ).first<Settings>())!;
    if (input.cover) await requireCover(c.env, settings.default_cover_id);
    const where = `status IN('ready','uploading') ${input.ids ? "AND id IN(SELECT value FROM json_each(?))" : ""} AND ${lease.guard()}`;
    const ids = input.ids ? [JSON.stringify([...new Set(input.ids)])] : [];
    if (input.ids) {
      const count = await c.env.DB.prepare(
        `SELECT COUNT(*) total FROM videos WHERE ${where}`,
      )
        .bind(...ids)
        .first<{ total: number }>();
      if (count!.total !== new Set(input.ids).size)
        throw bad("Some selected videos are unavailable. Refresh the library.");
    }
    const statements = [];
    if (input.caption)
      statements.push(
        c.env.DB.prepare(
          `UPDATE videos SET caption=?,hashtags='',caption_override=? WHERE ${where} ${!input.overwrite && input.caption !== "replace" ? "AND caption_override=0" : ""}`,
        ).bind(
          input.caption === "default" ? settings.default_caption : input.text!,
          input.caption === "replace" ? 1 : 0,
          ...ids,
        ),
      );
    if (input.cover)
      statements.push(
        c.env.DB.prepare(
          `UPDATE videos SET cover_id=?,cover_override=0,thumb_offset_ms=0 WHERE ${where} ${input.overwrite ? "" : "AND cover_override=0"}`,
        ).bind(settings.default_cover_id, ...ids),
      );
    const changes = await c.env.DB.batch(statements);
    return { ok: true, updated: changes.map((r) => r.meta.changes) };
  });
  return c.json(result);
});
bulk.patch("/videos/:id/cover", async (c) => {
  const input = z
    .object({
      mode: z.enum(["default", "override"]),
      cover_id: z.string().uuid().nullable().optional(),
      thumb_offset_ms: z.number().int().min(0).max(900000).default(0),
    })
    .parse(await c.req.json());
  await withLease(c.env, async (lease) => {
    const video = await c.env.DB.prepare(
      "SELECT * FROM videos WHERE id=? AND status='ready'",
    )
      .bind(c.req.param("id"))
      .first<Video>();
    if (!video) throw new HTTPException(404, { message: "Video not found." });
    const settings = (await c.env.DB.prepare(
      "SELECT * FROM settings WHERE id=1",
    ).first<Settings>())!;
    const id =
      input.mode === "default"
        ? settings.default_cover_id
        : (input.cover_id ?? null);
    await requireCover(c.env, id);
    const offset = id || input.mode === "default" ? 0 : input.thumb_offset_ms;
    if (offset >= video.duration_seconds * 1000)
      throw bad("Choose a frame inside the video's duration.");
    await c.env.DB.prepare(
      `UPDATE videos SET cover_id=?,cover_override=?,thumb_offset_ms=? WHERE id=? AND ${lease.guard()}`,
    )
      .bind(id, input.mode === "override" ? 1 : 0, offset, video.id)
      .run();
  });
  return c.json({ ok: true });
});
