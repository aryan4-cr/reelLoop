import {
  S3Client,
  PutObjectCommand,
  UploadPartCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HTTPException } from "hono/http-exception";
import type { Env, Video, Job } from "./types";
export const PART_SIZE = 16 * 1024 * 1024;
export function configured(env: Env) {
  return Boolean(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET_NAME,
  );
}
function client(env: Env) {
  if (!configured(env))
    throw new HTTPException(503, {
      message: "Configure private R2 upload credentials before uploading.",
    });
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
export async function uploadUrl(env: Env, v: Video, part?: number) {
  const command = v.multipart_id
    ? new UploadPartCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: `staging/${v.id}`,
        UploadId: v.multipart_id,
        PartNumber: part,
      })
    : new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: `staging/${v.id}`,
        ContentType: v.content_type,
      });
  return command instanceof UploadPartCommand
    ? getSignedUrl(client(env), command, { expiresIn: 900 })
    : getSignedUrl(client(env), command, { expiresIn: 900 });
}
export function validMagic(bytes: Uint8Array) {
  const marker = new TextDecoder().decode(bytes.slice(4, 8));
  return (
    bytes.length >= 12 && ["ftyp", "moov", "mdat", "wide"].includes(marker)
  );
}
export async function verifyUpload(
  env: Env,
  v: Video,
  copy?: (etag: string) => Promise<void>,
) {
  const head = await env.VIDEOS.head(`staging/${v.id}`);
  if (!head || head.size !== v.size_bytes)
    throw new HTTPException(400, {
      message: "Uploaded size does not match the reserved video.",
    });
  const chunk = await env.VIDEOS.get(`staging/${v.id}`, {
    range: { offset: 0, length: 32 },
    onlyIf: { etagMatches: head.etag },
  });
  if (
    !chunk ||
    !("body" in chunk) ||
    !validMagic(new Uint8Array(await new Response(chunk.body).arrayBuffer()))
  )
    throw new HTTPException(400, {
      message: "File is not a supported MP4/MOV container.",
    });
  if (copy) await copy(head.etag);
  else
    await client(env).send(
      new CopyObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: `videos/${v.id}`,
        CopySource: `${env.R2_BUCKET_NAME}/staging/${v.id}`,
        CopySourceIfMatch: head.httpEtag,
        MetadataDirective: "REPLACE",
        ContentType: v.content_type,
      }),
      { abortSignal: AbortSignal.timeout(20000) },
    );
  const final = await env.VIDEOS.head(`videos/${v.id}`);
  if (!final || final.size !== v.size_bytes)
    throw new HTTPException(400, {
      message: "Stored object verification failed. Retry finalization.",
    });
  await env.DB.prepare(
    "UPDATE videos SET status='ready',object_key=?,multipart_id=NULL,position=(SELECT COALESCE(MAX(position),-1)+1 FROM videos WHERE status='ready') WHERE id=? AND status='uploading'",
  )
    .bind(`videos/${v.id}`, v.id)
    .run();
  await env.VIDEOS.delete(`staging/${v.id}`);
}
export function parseRange(
  value: string | null,
  size: number,
): { offset: number; length: number } | null | "invalid" {
  if (!value) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2])) return "invalid";
  let start: number, end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    start < 0 ||
    end < start
  )
    return "invalid";
  return { offset: start, length: end - start + 1 };
}
export async function serveObject(
  env: Env,
  request: Request,
  key: string,
  type: string,
) {
  const head = await env.VIDEOS.head(key);
  if (!head) return new Response("Media not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    ETag: head.httpEtag,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const range = parseRange(request.headers.get("Range"), head.size);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${head.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Length", String(range?.length ?? head.size));
  if (range)
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`,
    );
  if (request.method === "HEAD")
    return new Response(null, { status: range ? 206 : 200, headers });
  const object = await env.VIDEOS.get(key, range ? { range } : undefined);
  if (!object) return new Response("Media not found", { status: 404 });
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
export async function cleanup(env: Env) {
  const stale = (
    await env.DB.prepare(
      "SELECT * FROM videos WHERE status='uploading' AND created_at<? LIMIT 10",
    )
      .bind(Date.now() - 86400000)
      .all<Video>()
  ).results;
  for (const v of stale) {
    try {
      if (v.multipart_id)
        await env.VIDEOS.resumeMultipartUpload(
          `staging/${v.id}`,
          v.multipart_id,
        ).abort();
      await env.VIDEOS.delete([`staging/${v.id}`, `videos/${v.id}`]);
      await env.DB.prepare(
        "DELETE FROM videos WHERE id=? AND status='uploading'",
      )
        .bind(v.id)
        .run();
    } catch {
      /* Keep reservation until storage cleanup succeeds. */
    }
  }
  const deleting = (
    await env.DB.prepare(
      "SELECT * FROM videos WHERE status='deleting' LIMIT 10",
    ).all<Video>()
  ).results;
  for (const v of deleting) {
    try {
      await env.VIDEOS.delete(v.object_key);
      await env.DB.prepare(
        "DELETE FROM videos WHERE id=? AND status='deleting'",
      )
        .bind(v.id)
        .run();
    } catch {
      /* Next cleanup retries. */
    }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(Date.now()),
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at<?").bind(
      Date.now(),
    ),
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(
      Date.now(),
    ),
  ]);
}
export async function mediaJob(env: Env, id: string) {
  return env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<Job>();
}
