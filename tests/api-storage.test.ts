import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { init, reset, mf, env, now, video, account, advance } from "./fixture";
import { app } from "../worker/index";
import { parseRange, validMagic, verifyUpload } from "../worker/storage";
import {
  sha256,
  encryptToken,
  decryptToken,
  mediaUrl,
  randomToken,
} from "../worker/security";
import { withLease } from "../worker/lease";
import { createJob } from "../worker/scheduler";
import type { Account } from "../worker/types";
let cookie = "",
  csrf = "";
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  auth = true,
  extra: Record<string, string> = {},
) {
  return app.fetch(
    new Request("https://reelloop.example" + path, {
      method,
      headers: {
        Origin: env.APP_ORIGIN,
        "Content-Type": "application/json",
        ...(auth ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}
async function login() {
  const res = await request(
    "/api/auth/login",
    "POST",
    { password: "test-password-only" },
    false,
  );
  cookie = res.headers.get("set-cookie")!.split(";")[0];
  csrf = ((await res.json()) as { csrf: string }).csrf;
  return res;
}
const container = () =>
  new Uint8Array([
    0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
  ]);
describe("authenticated API and R2 integration", () => {
  beforeAll(init);
  beforeEach(async () => {
    await reset();
    cookie = "";
    csrf = "";
  });
  afterAll(async () => await mf.dispose());
  it("redirects HTTP pages to the trusted HTTPS origin and rejects HTTP credentials before persistence", async () => {
    const page = await app.fetch(
      new Request("http://untrusted.example/?tab=settings"),
      env,
    );
    expect(page.status).toBe(308);
    expect(page.headers.get("location")).toBe(
      "https://reelloop.example/?tab=settings",
    );
    const login = await app.fetch(
      new Request("http://reelloop.example/api/auth/login", {
        method: "POST",
        headers: { Origin: env.APP_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-only" }),
      }),
      env,
    );
    expect(login.status).toBe(400);
    expect(login.headers.has("set-cookie")).toBe(false);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM sessions").first("n"),
    ).toBe(0);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM rate_limits").first("n"),
    ).toBe(0);
    const local = await app.fetch(new Request("http://127.0.0.1:8787/"), {
      ...env,
      APP_ORIGIN: "http://127.0.0.1:8787",
    });
    expect(local.status).toBe(200);
  });
  it("protects every administrative route without a session", async () => {
    for (const [path, method] of [
      ["/api/dashboard", "GET"],
      ["/api/settings", "PATCH"],
      ["/api/publish/test", "POST"],
      ["/api/uploads", "POST"],
      ["/api/videos/a", "DELETE"],
    ])
      expect(
        (await request(path, method, method === "GET" ? undefined : {}, false))
          .status,
      ).toBe(401);
  });
  it("requires owner password, uses secure HttpOnly cookies and expires sessions", async () => {
    expect(
      (await request("/api/auth/login", "POST", { password: "bad" }, false))
        .status,
    ).toBe(401);
    const r = await login();
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    expect(r.headers.get("set-cookie")).toContain("Secure");
    expect((await request("/api/dashboard")).status).toBe(200);
    advance(13 * 3600000);
    expect((await request("/api/dashboard")).status).toBe(401);
  });
  it("enforces Origin and CSRF on settings, uploads, deletes and publishing", async () => {
    await login();
    expect(
      (
        await request("/api/schedule/pause", "POST", {}, true, {
          "X-CSRF-Token": "wrong",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/schedule/pause", "POST", {}, true, {
          Origin: "https://attacker.example",
        })
      ).status,
    ).toBe(403);
  });
  it("rate limits password guessing", async () => {
    for (let i = 0; i < 5; i++)
      await request("/api/auth/login", "POST", { password: "wrong" }, false);
    expect(
      (await request("/api/auth/login", "POST", { password: "wrong" }, false))
        .status,
    ).toBe(429);
  });
  it("returns real empty state without secrets and validates scheduling", async () => {
    await login();
    const r = await request("/api/dashboard");
    const d = (await r.json()) as {
      settings: { enabled: number; interval_minutes: number };
      videos: unknown[];
    };
    expect(d.settings.enabled).toBe(0);
    expect(d.settings.interval_minutes).toBe(180);
    expect(d.videos).toHaveLength(0);
    expect(JSON.stringify(d)).not.toContain("lease_token");
    expect(
      (
        await request("/api/settings", "PATCH", {
          interval_minutes: 1,
          timezone: "made-up",
          mode: "loop",
          cooldown_minutes: 0,
        })
      ).status,
    ).toBe(400);
  });
  it("reorders all verified videos atomically and rejects stale orders", async () => {
    await login();
    await video("a", 0);
    await video("b", 1);
    expect(
      (await request("/api/videos/reorder", "POST", { ids: ["b", "a"] }))
        .status,
    ).toBe(200);
    expect(
      (
        await env.DB.prepare("SELECT position FROM videos WHERE id='b'").first<{
          position: number;
        }>()
      )?.position,
    ).toBe(0);
    expect(
      (await request("/api/videos/reorder", "POST", { ids: ["a"] })).status,
    ).toBe(409);
  });
  it("uses one-time session-bound OAuth state and rejects cross-session callbacks", async () => {
    await login();
    const res = await request("/api/instagram/connect", "POST", {});
    const { url } = (await res.json()) as { url: string };
    const auth = new URL(url);
    expect(auth.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_content_publish",
    );
    const state = auth.searchParams.get("state")!;
    expect(
      (
        await request(
          `/api/instagram/callback?state=${state}&error=access_denied`,
        )
      ).status,
    ).toBe(302);
    expect(
      (
        await request(
          `/api/instagram/callback?state=${state}&error=access_denied`,
        )
      ).status,
    ).toBe(403);
  });
  it("rejects a forged OAuth state and missing session", async () => {
    await login();
    expect(
      (await request("/api/instagram/callback?state=forged&code=x")).status,
    ).toBe(403);
    expect(
      (
        await request(
          "/api/instagram/callback?state=forged&code=x",
          "GET",
          undefined,
          false,
        )
      ).status,
    ).toBe(401);
  });
  it("requires explicit manual publish confirmation and blocks a second job", async () => {
    await login();
    await account();
    await video();
    expect(
      (await request("/api/publish/test", "POST", { video_id: "a" })).status,
    ).toBe(400);
    expect(
      (
        await request("/api/publish/test", "POST", {
          video_id: "a",
          confirmation: "PUBLISH ONE REEL",
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await request("/api/publish/test", "POST", {
          video_id: "a",
          confirmation: "PUBLISH ONE REEL",
        })
      ).status,
    ).toBe(409);
    expect((await request("/api/videos/a", "DELETE")).status).toBe(409);
  });
  it("persists pause and resumes with a chosen UTC instant", async () => {
    await login();
    await account();
    await video();
    const at = now + 1800000;
    expect(
      (await request("/api/schedule/start", "POST", { start_at: at })).status,
    ).toBe(200);
    expect((await request("/api/schedule/pause", "POST", {})).status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT enabled,next_publish_at FROM settings",
    ).first<{ enabled: number; next_publish_at: number }>();
    expect(row?.enabled).toBe(0);
    expect(row?.next_publish_at).toBe(at);
    expect((await request("/api/schedule/start", "POST", {})).status).toBe(200);
  });
  it("validates uploads before contacting R2", async () => {
    await login();
    const r = await request("/api/uploads", "POST", {
      name: "x.exe",
      content_type: "video/mp4",
      size_bytes: 1000000001,
      duration_seconds: 2,
      width: 9000,
      height: 1920,
    });
    expect(r.status).toBe(400);
  });
  it("only promotes correctly sized MP4 containers and preserves originals after verification", async () => {
    const v = await video("pending", 0, "uploading");
    await env.VIDEOS.put("staging/pending", container());
    await verifyUpload(env, v, async () => {
      await env.VIDEOS.put("videos/pending", container());
    });
    expect(
      (
        await env.DB.prepare(
          "SELECT status FROM videos WHERE id='pending'",
        ).first<{ status: string }>()
      )?.status,
    ).toBe("ready");
    expect(await env.VIDEOS.head("videos/pending")).toBeTruthy();
    expect(await env.VIDEOS.head("staging/pending")).toBeNull();
  });
  it("rejects incomplete and nonvideo objects from the queue", async () => {
    const v = await video("pending", 0, "uploading");
    await env.VIDEOS.put("staging/pending", new Uint8Array(8));
    await expect(verifyUpload(env, v, async () => {})).rejects.toThrow("size");
    await env.VIDEOS.put("staging/pending", new Uint8Array(16));
    await expect(verifyUpload(env, v, async () => {})).rejects.toThrow(
      "MP4/MOV",
    );
  });
  it("preserves pending objects if the finalization lease expires during promotion", async () => {
    const v = await video("expired", 0, "uploading");
    await env.VIDEOS.put("staging/expired", container());
    await expect(
      withLease(env, (lease) =>
        verifyUpload(
          env,
          v,
          async () => {
            await env.VIDEOS.put("videos/expired", container());
            advance(120001);
          },
          lease,
        ),
      ),
    ).rejects.toThrow("database finalization");
    expect(
      (
        await env.DB.prepare(
          "SELECT status FROM videos WHERE id='expired'",
        ).first()
      )?.status,
    ).toBe("uploading");
    expect(await env.VIDEOS.head("staging/expired")).not.toBeNull();
  });
  it("keeps ready durable when staging deletion fails", async () => {
    const v = await video("cleanup", 0, "uploading");
    await env.VIDEOS.put("staging/cleanup", container());
    vi.spyOn(env.VIDEOS, "delete").mockRejectedValue(
      new Error("test storage failure"),
    );
    await verifyUpload(env, v, async () => {
      await env.VIDEOS.put("videos/cleanup", container());
    });
    expect(
      (
        await env.DB.prepare(
          "SELECT status FROM videos WHERE id='cleanup'",
        ).first()
      )?.status,
    ).toBe("ready");
    expect(await env.VIDEOS.head("videos/cleanup")).not.toBeNull();
  });
  it("reports token encryption failure without persisting the account or logging secrets", async () => {
    await login();
    const connect = await request("/api/instagram/connect", "POST", {});
    const state = new URL(
      ((await connect.json()) as { url: string }).url,
    ).searchParams.get("state");
    const oldKey = env.TOKEN_ENCRYPTION_KEY;
    env.TOKEN_ENCRYPTION_KEY = "invalid-test-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        access_token: "test-sensitive-token",
        expires_in: 3600,
        user_id: "123",
        username: "test",
      }),
    );
    // Each response needs a fresh readable body.
    fetchMock.mockImplementation(async () =>
      Response.json({
        access_token: "test-sensitive-token",
        expires_in: 3600,
        user_id: "123",
        username: "test",
      }),
    );
    const logs = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await request(
        "/api/instagram/callback?state=" + state + "&code=test-sensitive-code",
      );
      expect(res.status).toBe(500);
      expect(((await res.json()) as { stage: string }).stage).toBe(
        "oauth_encryption",
      );
      expect(await env.DB.prepare("SELECT * FROM accounts").first()).toBeNull();
      expect(JSON.stringify(logs.mock.calls)).not.toContain("test-sensitive");
      expect(JSON.stringify(logs.mock.calls)).not.toContain("invalid-test-key");
    } finally {
      env.TOKEN_ENCRYPTION_KEY = oldKey;
    }
  });
  it("serves signed job-specific media with GET, HEAD, suffix and invalid ranges", async () => {
    const v = await video();
    await account();
    await env.VIDEOS.put(v.object_key, container());
    const a = (await env.DB.prepare(
      "SELECT * FROM accounts",
    ).first<Account>())!;
    const id = await withLease(env, (l) => createJob(env, l, v, a, true, now));
    const row = await env.DB.prepare(
      "SELECT media_expires_at FROM jobs WHERE id=?",
    )
      .bind(id)
      .first<{ media_expires_at: number }>();
    const url = await mediaUrl(env, id, row!.media_expires_at),
      path = new URL(url).pathname + new URL(url).search;
    const full = await request(path, "GET", undefined, false);
    expect(full.status).toBe(200);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(container());
    const partial = await request(path, "GET", undefined, false, {
      Range: "bytes=4-7",
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 4-7/16");
    expect(await partial.text()).toBe("ftyp");
    const head = await request(path, "HEAD", undefined, false);
    expect(head.headers.get("content-length")).toBe("16");
    expect(await head.text()).toBe("");
    expect(
      (await request(path, "GET", undefined, false, { Range: "bytes=999-" }))
        .status,
    ).toBe(416);
    expect(
      (await request(path + "&sig=forged", "GET", undefined, false)).status,
    ).toBe(200);
    expect(
      (
        await request(
          path.replace(/sig=[^&]+/, "sig=forged"),
          "GET",
          undefined,
          false,
        )
      ).status,
    ).toBe(403);
    advance(86400001);
    expect((await request(path, "GET", undefined, false)).status).toBe(403);
  });
  it("encrypts tokens, detects tampering and issues unpredictable session identifiers", async () => {
    const encrypted = await encryptToken(env, "private-test-token");
    expect(encrypted).not.toContain("private-test-token");
    expect(await decryptToken(env, encrypted)).toBe("private-test-token");
    await expect(
      decryptToken(env, encrypted.slice(0, -2) + "AA"),
    ).rejects.toThrow();
    expect(randomToken()).not.toBe(randomToken());
    expect(await sha256("a")).toHaveLength(64);
  });
  it("supports byte-range boundaries and checks file magic", () => {
    expect(parseRange("bytes=-4", 16)).toEqual({ offset: 12, length: 4 });
    expect(parseRange("bytes=4-", 16)).toEqual({ offset: 4, length: 12 });
    expect(parseRange("bytes=0-99", 16)).toEqual({ offset: 0, length: 16 });
    expect(parseRange("bytes=0-1,4-5", 16)).toBe("invalid");
    expect(validMagic(container())).toBe(true);
  });

  it("rejects oversized JSON even without Content-Length", async () => {
    await login();
    expect(
      (await request("/api/settings", "PATCH", { padding: "x".repeat(40000) }))
        .status,
    ).toBe(413);
  });
  it("appends a completed upload after the current reordered queue", async () => {
    await video("a", 0);
    const v = await video("pending", 0, "uploading");
    await video("b", 1);
    await env.VIDEOS.put("staging/pending", container());
    await verifyUpload(env, v, async () => {
      await env.VIDEOS.put("videos/pending", container());
    });
    const row = await env.DB.prepare(
      "SELECT position FROM videos WHERE id='pending'",
    ).first<{ position: number }>();
    expect(row?.position).toBe(2);
    await env.VIDEOS.put("staging/pending", new Uint8Array(16));
    const final = await env.VIDEOS.get("videos/pending");
    expect(
      new Uint8Array(await new Response(final!.body).arrayBuffer()),
    ).toEqual(container());
  });
});
