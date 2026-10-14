import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { Env, Video } from "../worker/types";
import { decryptToken } from "../worker/security";

// Exercise the real browser-target Worker bundle, including native fetch and
// AWS response deserialization. Every external request is intercepted locally.
describe("production Worker runtime integration", () => {
  let mf: Miniflare, db: D1Database, bucket: R2Bucket;
  let mode = "success",
    calls: string[] = [];
  const origin = "https://reelloop.example";
  const tokenKey = Buffer.alloc(32, 7).toString("base64");
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const config = JSON.parse(
    readFileSync("wrangler.jsonc", "utf8").replace(/,\s*([}\]])/g, "$1"),
  );
  beforeAll(async () => {
    const bundle = await build({
      entryPoints: ["worker/index.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      alias: config.alias,
    });
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: process.env.REELLOOP_WORKER_BUNDLE
          ? readFileSync(process.env.REELLOOP_WORKER_BUNDLE, "utf8")
          : bundle.outputFiles[0].text,
        compatibilityDate: config.compatibility_date,
        compatibilityFlags: config.compatibility_flags,
        d1Databases: { DB: "runtime-test" },
        r2Buckets: { VIDEOS: "runtime-test" },
        bindings: {
          APP_ORIGIN: origin,
          PUBLIC_ORIGIN: origin,
          META_API_VERSION: "v25.0",
          META_APP_ID: "test-app",
          META_APP_SECRET: "test-secret-only",
          TOKEN_ENCRYPTION_KEY: tokenKey,
          MEDIA_SIGNING_KEY: "test-only",
          R2_ACCOUNT_ID: "test",
          R2_BUCKET_NAME: "test-bucket",
          R2_ACCESS_KEY_ID: "test-only",
          R2_SECRET_ACCESS_KEY: "test-only",
          MAX_STORAGE_BYTES: "8000000000",
        },
        outboundService: async (req) => {
          const url = new URL(req.url);
          calls.push(url.pathname); // Never store query strings or headers.
          if (url.hostname === "api.instagram.com") {
            expect((await req.formData()).get("redirect_uri")).toBe(
              origin + "/api/instagram/callback",
            );
            if (mode === "oauth_code")
              return Response.json(
                { error: { code: 100, message: "secret-provider-detail" } },
                { status: 400 },
              );
            if (mode === "malformed")
              return new Response("secret-provider-detail", { status: 502 });
            return Response.json({
              access_token: "short-test-token",
              user_id: "123",
            });
          }
          if (
            url.hostname === "graph.instagram.com" &&
            url.pathname === "/access_token"
          ) {
            if (mode === "oauth_long_token")
              return Response.json({
                access_token: "long-test-token",
                expires_in: -1,
              });
            return Response.json({
              access_token: "long-test-token",
              expires_in: 5184000,
            });
          }
          if (
            url.hostname === "graph.instagram.com" &&
            url.pathname === "/v25.0/me"
          ) {
            if (mode === "oauth_profile")
              return Response.json({ error: { code: 190 } }, { status: 401 });
            return Response.json({ user_id: "123", username: "testcreator" });
          }
          if (
            url.hostname.endsWith(".r2.cloudflarestorage.com") &&
            req.method === "PUT" &&
            req.headers.has("x-amz-copy-source")
          ) {
            if (mode === "copy_error")
              return new Response(
                "<Error><Code>AccessDenied</Code><Message>secret-provider-detail</Message></Error>",
                { status: 403 },
              );
            if (mode === "copy_embedded_error")
              return new Response(
                "<Error><Code>AccessDenied</Code><Message>secret-provider-detail</Message></Error>",
              );
            const source = req.headers
              .get("x-amz-copy-source")!
              .replace(/^\/?test-bucket\//, "");
            const key = url.pathname
              .replace(/^\/test-bucket\//, "")
              .replace(/^\//, "");
            const object = await bucket.get(source);
            if (!object) throw new Error("Missing local test object");
            if (mode !== "missing_final") await bucket.put(key, object.body);
            else await object.body.cancel();
            return new Response(
              '<CopyObjectResult><ETag>"test-etag"</ETag><LastModified>2026-10-14T00:00:00.000Z</LastModified></CopyObjectResult>',
              { headers: { "Content-Type": "application/xml" } },
            );
          }
          throw new Error("Unexpected external request in isolated test");
        },
      }),
    );
    db = (await mf.getD1Database("DB")) as unknown as D1Database;
    bucket = (await mf.getR2Bucket("VIDEOS")) as unknown as R2Bucket;
    const sql = (
      readFileSync("migrations/0001_initial.sql", "utf8") +
      readFileSync("migrations/0002_bulk_reel_settings.sql", "utf8")
    ).replace(/^\uFEFF/, "");
    await db.batch(
      sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  });
  afterAll(async () => {
    await mf?.dispose();
  });
  beforeEach(async () => {
    mode = "success";
    calls = [];
    await db.batch(
      [
        "UPDATE settings SET default_caption='',default_cover_id=NULL",
        "DROP TRIGGER IF EXISTS reject_account",
        "DROP TRIGGER IF EXISTS reject_video",
        ...[
          "accounts",
          "sessions",
          "oauth_states",
          "videos",
          "rate_limits",
          "covers",
        ].map((t) => `DELETE FROM ${t}`),
        "UPDATE settings SET enabled=0,lease_token=NULL,lease_until=0,next_publish_at=NULL",
      ].map((s) => db.prepare(s)),
    );
    const objects = await bucket.list();
    if (objects.objects.length)
      await bucket.delete(objects.objects.map((o) => o.key));
    await db
      .prepare("INSERT INTO sessions(id_hash,csrf,expires_at) VALUES(?,?,?)")
      .bind(hash("test-session"), "test-csrf", Date.now() + 3600000)
      .run();
    await db
      .prepare(
        "INSERT INTO oauth_states(state_hash,session_hash,expires_at) VALUES(?,?,?)",
      )
      .bind(hash("test-state"), hash("test-session"), Date.now() + 600000)
      .run();
  });
  function request(path: string, body?: unknown) {
    return mf.dispatchFetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        Cookie: "reelloop_session=test-session",
        Origin: origin,
        "X-CSRF-Token": "test-csrf",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const callback = () =>
    request("/api/instagram/callback?state=test-state&code=test-code");
  async function reserve(size = 32) {
    const res = await request("/api/uploads", {
      name: "test.mp4",
      content_type: "video/mp4",
      size_bytes: size,
      duration_seconds: 5,
      width: 1080,
      height: 1920,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string };
  }
  const complete = (id: string, parts?: R2UploadedPart[]) =>
    request(`/api/uploads/${id}/complete`, { parts });
  function container(size = 32) {
    const bytes = new Uint8Array(size);
    bytes.set(new TextEncoder().encode("ftyp"), 4);
    return bytes;
  }
  async function expectFailure(
    res: Awaited<ReturnType<typeof request>>,
    stage: string,
  ) {
    expect(res.status).toBeGreaterThanOrEqual(400);
    const value = await res.text();
    expect(JSON.parse(value).stage, value).toBe(stage);
    for (const secret of [
      "test-code",
      "test-secret-only",
      "short-test-token",
      "long-test-token",
      "secret-provider-detail",
      "test-session",
    ])
      expect(value).not.toContain(secret);
  }
  it("exchanges using native fetch, encrypts and persists the account with publishing paused", async () => {
    expect((await callback()).status).toBe(302);
    expect(calls).toEqual([
      "/oauth/access_token",
      "/access_token",
      "/v25.0/me",
    ]);
    const account = await db
      .prepare("SELECT * FROM accounts")
      .first<{ token_cipher: string; instagram_id: string }>();
    expect(account?.instagram_id).toBe("123");
    expect(
      await decryptToken(
        { TOKEN_ENCRYPTION_KEY: tokenKey } as Env,
        account!.token_cipher,
      ),
    ).toBe("long-test-token");
    expect(
      (await db.prepare("SELECT enabled FROM settings").first())?.enabled,
    ).toBe(0);
    expect(await db.prepare("SELECT * FROM jobs").first()).toBeNull();
    expect(await db.prepare("SELECT * FROM oauth_states").first()).toBeNull();
    await expectFailure(await callback(), "oauth_state");
    expect(calls).toHaveLength(3);
  });
  it.each(["oauth_code", "oauth_long_token", "oauth_profile", "malformed"])(
    "reports %s without leaking provider data or saving tokens",
    async (failure) => {
      mode = failure;
      await expectFailure(
        await callback(),
        failure === "malformed" ? "oauth_code" : failure,
      );
      expect(await db.prepare("SELECT * FROM accounts").first()).toBeNull();
    },
  );
  it("reports account persistence failure and rolls back the transaction", async () => {
    await db
      .prepare(
        "CREATE TRIGGER reject_account BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT, 'test failure'); END",
      )
      .run();
    await expectFailure(await callback(), "oauth_persistence");
    expect(await db.prepare("SELECT * FROM accounts").first()).toBeNull();
  });
  it("deserializes real SDK copy XML, verifies R2 and commits ready exactly once", async () => {
    const { id } = await reserve();
    await bucket.put(`staging/${id}`, container());
    expect((await complete(id)).status).toBe(200);
    expect(
      await db
        .prepare("SELECT status,object_key FROM videos WHERE id=?")
        .bind(id)
        .first(),
    ).toEqual({ status: "ready", object_key: `videos/${id}` });
    expect(await bucket.head(`staging/${id}`)).toBeNull();
    expect((await bucket.head(`videos/${id}`))?.size).toBe(32);
    expect((await complete(id)).status).toBe(200);
    expect(calls).toHaveLength(1);
  });
  it.each(["copy_error", "copy_embedded_error", "missing_final", "database"])(
    "preserves staging on %s and supports finalization retry",
    async (failure) => {
      const { id } = await reserve();
      await bucket.put(`staging/${id}`, container());
      mode = failure;
      if (failure === "database")
        await db
          .prepare(
            "CREATE TRIGGER reject_video BEFORE UPDATE ON videos BEGIN SELECT RAISE(ABORT, 'test failure'); END",
          )
          .run();
      await expectFailure(
        await complete(id),
        failure === "database"
          ? "upload_persistence"
          : failure === "missing_final"
            ? "upload_final_verification"
            : "upload_promotion",
      );
      expect(
        (
          await db
            .prepare("SELECT status FROM videos WHERE id=?")
            .bind(id)
            .first()
        )?.status,
      ).toBe("uploading");
      expect(await bucket.head(`staging/${id}`)).not.toBeNull();
      mode = "success";
      await db.prepare("DROP TRIGGER IF EXISTS reject_video").run();
      expect((await complete(id)).status).toBe(200);
      expect(
        (
          await db
            .prepare("SELECT status FROM videos WHERE id=?")
            .bind(id)
            .first()
        )?.status,
      ).toBe("ready");
    },
  );
  it("completes a real local multipart upload then retries promotion without completing twice", async () => {
    const size = 33 * 1024 * 1024;
    const { id } = await reserve(size);
    const row = (await db
      .prepare("SELECT * FROM videos WHERE id=?")
      .bind(id)
      .first<Video>())!;
    const multi = bucket.resumeMultipartUpload(
      `staging/${id}`,
      row.multipart_id!,
    );
    const parts = [
      await multi.uploadPart(1, container(16 * 1024 * 1024)),
      await multi.uploadPart(2, new Uint8Array(16 * 1024 * 1024)),
      await multi.uploadPart(3, new Uint8Array(1024 * 1024)),
    ];
    mode = "copy_error";
    await expectFailure(await complete(id, parts), "upload_promotion");
    expect((await bucket.head(`staging/${id}`))?.size).toBe(size);
    mode = "success";
    expect((await complete(id)).status).toBe(200);
    expect((await bucket.head(`videos/${id}`))?.size).toBe(size);
    expect(
      (await db.prepare("SELECT enabled FROM settings").first())?.enabled,
    ).toBe(0);
  });
  it("finalizes a JPEG cover in native workerd and persists shared defaults", async () => {
    const jpeg = readFileSync("tests/fixtures/cover.jpg");
    const reserved = await request("/api/covers", {
      name: "cover.jpg",
      size_bytes: jpeg.length,
    });
    expect(reserved.status).toBe(201);
    const { id } = (await reserved.json()) as { id: string };
    await bucket.put(`staging/covers/${id}`, jpeg, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    expect((await request(`/api/covers/${id}/complete`, {})).status).toBe(200);
    expect(
      await db
        .prepare("SELECT status,width,height FROM covers WHERE id=?")
        .bind(id)
        .first(),
    ).toEqual({ status: "ready", width: 320, height: 480 });
    expect((await request(`/api/covers/${id}/preview`)).status).toBe(200);
    expect(calls).toHaveLength(0);
  });
});
