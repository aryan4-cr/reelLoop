import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";
const enc = new TextEncoder();
export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
export async function sha256(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}
export function cookieValue(request: Request, name: string) {
  return request.headers
    .get("Cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
}
export async function passwordMatches(password: string, hash: string) {
  const [scheme, rounds, salt, expected] = hash.split("$");
  const iterations = Number(rounds);
  if (
    scheme !== "pbkdf2" ||
    !Number.isInteger(iterations) ||
    iterations < 100000 ||
    iterations > 1000000 ||
    !salt ||
    !expected
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const result = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations },
    key,
    256,
  );
  return safeEqual(
    Array.from(new Uint8Array(result), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join(""),
    expected,
  );
}
export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowMs = 60000,
) {
  const now = Date.now();
  const result = await env.DB.prepare(
    `INSERT INTO rate_limits(key,hits,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END, expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING hits`,
  )
    .bind(key, now + windowMs, now, now, now + windowMs)
    .first<{ hits: number }>();
  if (result && result.hits > limit)
    throw new HTTPException(429, {
      message: "Too many requests. Please try again later.",
    });
}
export async function getSession(env: Env, request: Request) {
  const raw = cookieValue(request, "reelloop_session");
  if (!raw) return null;
  const hash = await sha256(raw);
  const session = await env.DB.prepare(
    "SELECT csrf,expires_at FROM sessions WHERE id_hash=? AND expires_at>?",
  )
    .bind(hash, Date.now())
    .first<{ csrf: string; expires_at: number }>();
  return session ? { ...session, hash } : null;
}
export function requireOrigin(env: Env, request: Request) {
  if (request.headers.get("Origin") !== new URL(env.APP_ORIGIN).origin)
    throw new HTTPException(403, { message: "Request origin is not allowed." });
}
function decode64(v: string) {
  return Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
}
function encode64(v: Uint8Array) {
  return btoa(String.fromCharCode(...v));
}
async function encryptionKey(env: Env) {
  if (!env.TOKEN_ENCRYPTION_KEY)
    throw new Error("Token encryption is not configured.");
  const raw = decode64(env.TOKEN_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("Invalid token encryption key.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptToken(env: Env, token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode("reelloop-meta-v1") },
    await encryptionKey(env),
    enc.encode(token),
  );
  return encode64(iv) + "." + encode64(new Uint8Array(cipher));
}
export async function decryptToken(env: Env, stored: string) {
  const [iv, data] = stored.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode64(iv),
        additionalData: enc.encode("reelloop-meta-v1"),
      },
      await encryptionKey(env),
      decode64(data),
    ),
  );
}
export async function mediaSignature(env: Env, jobId: string, expires: number) {
  if (!env.MEDIA_SIGNING_KEY || env.MEDIA_SIGNING_KEY.length < 32)
    throw new Error("Media signing is not configured.");
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.MEDIA_SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${jobId}:${expires}`),
  );
  return Array.from(new Uint8Array(sig), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function mediaUrl(env: Env, jobId: string, expires: number) {
  return `${env.PUBLIC_ORIGIN}/media/${jobId}?expires=${expires}&sig=${await mediaSignature(env, jobId, expires)}`;
}
