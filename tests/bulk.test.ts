import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import {
  init,
  reset,
  mf,
  env,
  video,
  account,
  now,
  advance,
  adapter,
} from "./fixture";
import { app } from "../worker/index";
import { createJob, tick } from "../worker/scheduler";
import { withLease } from "../worker/lease";
import { coverUrl, mediaUrl, sha256 } from "../worker/security";
import { jpegDimensions } from "../worker/bulk";
import { captionText } from "../worker/validation";
import { selectNext } from "../worker/queue";
import type { Video, Account, Settings, Job, Cover } from "../worker/types";
const jpeg = new Uint8Array(readFileSync("tests/fixtures/cover.jpg"));
function request(path: string, method = "GET", body?: unknown, auth = true) {
  return app.fetch(
    new Request("https://reelloop.example" + path, {
      method,
      headers: {
        Origin: env.APP_ORIGIN,
        "Content-Type": "application/json",
        ...(auth
          ? {
              Cookie: "reelloop_session=bulk-test",
              "X-CSRF-Token": "test-csrf",
            }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}
async function savedCover() {
  const response = await request("/api/covers", "POST", {
    name: "cover.jpg",
    size_bytes: jpeg.length,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await env.VIDEOS.put(`staging/covers/${id}`, jpeg, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  const result = await request(`/api/covers/${id}/complete`, "POST", {});
  expect(result.status, await result.clone().text()).toBe(200);
  return ((await result.json()) as { id: string }).id;
}
const row = (id: string) =>
  env.DB.prepare("SELECT * FROM videos WHERE id=?").bind(id).first<Video>();
describe("bulk captions and shared covers", () => {
  beforeAll(init);
  afterAll(() => mf.dispose());
  beforeEach(async () => {
    await reset();
    const objects = await env.VIDEOS.list();
    if (objects.objects.length)
      await env.VIDEOS.delete(objects.objects.map((o) => o.key));
    await env.DB.prepare(
      "INSERT INTO sessions(id_hash,csrf,expires_at) VALUES(?,?,?)",
    )
      .bind(await sha256("bulk-test"), "test-csrf", now + 3600000)
      .run();
  });
  it("persists defaults and inherits them for future uploads without changing old videos", async () => {
    await video("existing");
    const id = await savedCover();
    expect(
      (
        await request("/api/bulk/defaults", "PATCH", {
          caption: "A story ✨\n#reels",
          cover_id: id,
        })
      ).status,
    ).toBe(200);
    const result = await request("/api/uploads", "POST", {
      name: "new.mp4",
      size_bytes: 32,
      content_type: "video/mp4",
      duration_seconds: 5,
      width: 1080,
      height: 1920,
    });
    expect(result.status).toBe(201);
    const v = await row(((await result.json()) as { id: string }).id);
    expect(v?.caption).toBe("A story ✨\n#reels");
    expect(v?.cover_id).toBe(id);
    expect(v?.caption_override).toBe(0);
    expect((await row("existing"))?.caption).toBe("");
    const dash = await request("/api/dashboard");
    expect(
      ((await dash.json()) as { settings: Settings }).settings.default_cover_id,
    ).toBe(id);
  });
  it("applies defaults to all or selected videos, preserving and explicitly resetting overrides", async () => {
    await video("a");
    await video("b");
    await request("/api/bulk/defaults", "PATCH", { caption: "Default #reels" });
    await request("/api/videos/b", "PATCH", {
      name: "b",
      caption: "Individual",
      hashtags: "",
      enabled: true,
    });
    expect(
      (await request("/api/bulk/apply", "POST", { caption: "default" })).status,
    ).toBe(200);
    expect((await row("a"))?.caption).toBe("Default #reels");
    expect((await row("b"))?.caption).toBe("Individual");
    expect(
      (
        await request("/api/bulk/apply", "POST", {
          ids: ["b"],
          caption: "default",
          overwrite: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/bulk/apply", "POST", {
          ids: ["b"],
          caption: "default",
          overwrite: true,
          confirm: true,
        })
      ).status,
    ).toBe(200);
    expect((await row("b"))?.caption_override).toBe(0);
    await request("/api/bulk/apply", "POST", {
      ids: ["a"],
      caption: "replace",
      text: "New selected",
      confirm: true,
    });
    expect((await row("a"))?.caption).toBe("New selected");
    expect((await row("a"))?.caption_override).toBe(1);
    expect((await row("b"))?.caption).toBe("Default #reels");
    expect(
      (
        await request("/api/bulk/apply", "POST", {
          ids: ["a", "missing"],
          caption: "default",
          overwrite: true,
          confirm: true,
        })
      ).status,
    ).toBe(400);
    expect((await row("a"))?.caption).toBe("New selected");
  });
  it("stores one physical shared image and protects references from deletion", async () => {
    const id = await savedCover();
    expect(await savedCover()).toBe(id);
    expect((await env.VIDEOS.list({ prefix: "covers/" })).objects).toHaveLength(
      1,
    );
    await video("a");
    await video("b");
    await request("/api/bulk/defaults", "PATCH", { cover_id: id });
    await request("/api/bulk/apply", "POST", { cover: "default" });
    expect((await row("a"))?.cover_id).toBe(id);
    expect((await row("b"))?.cover_id).toBe(id);
    expect((await request(`/api/covers/${id}`, "DELETE")).status).toBe(409);
    await request("/api/bulk/defaults", "PATCH", { cover_id: null });
    expect((await row("a"))?.cover_id).toBe(id);
    expect((await request(`/api/covers/${id}`, "DELETE")).status).toBe(409);
    await request("/api/bulk/apply", "POST", {
      cover: "default",
      overwrite: true,
      confirm: true,
    });
    expect((await request(`/api/covers/${id}`, "DELETE")).status).toBe(200);
    expect((await env.VIDEOS.list({ prefix: "covers/" })).objects).toHaveLength(
      0,
    );
  });
  it("keeps individual cover overrides and supports reset and frame selection", async () => {
    const id = await savedCover();
    await video("a");
    await request("/api/bulk/defaults", "PATCH", { cover_id: id });
    await request("/api/videos/a/cover", "PATCH", {
      mode: "override",
      cover_id: null,
      thumb_offset_ms: 2500,
    });
    await request("/api/bulk/apply", "POST", { cover: "default" });
    expect((await row("a"))?.thumb_offset_ms).toBe(2500);
    expect((await row("a"))?.cover_id).toBeNull();
    await request("/api/videos/a/cover", "PATCH", { mode: "default" });
    expect((await row("a"))?.cover_id).toBe(id);
    expect((await row("a"))?.cover_override).toBe(0);
    expect(
      (
        await request("/api/videos/a/cover", "PATCH", {
          mode: "override",
          thumb_offset_ms: 5000,
        })
      ).status,
    ).toBe(400);
  });
  it("snapshots caption and cover for the job, signs only its image, and retains covers for history", async () => {
    const id = await savedCover();
    await video("a");
    await account();
    await request("/api/bulk/defaults", "PATCH", {
      caption: "Snapshot",
      cover_id: id,
    });
    await request("/api/bulk/apply", "POST", {
      caption: "default",
      cover: "default",
    });
    const acct = (await env.DB.prepare(
      "SELECT * FROM accounts",
    ).first<Account>())!;
    const jobId = await withLease(env, async (l) =>
      createJob(env, l, (await row("a"))!, acct, true, now),
    );
    await request("/api/bulk/defaults", "PATCH", {
      caption: "Changed",
      cover_id: null,
    });
    await request("/api/bulk/apply", "POST", {
      caption: "default",
      cover: "default",
      overwrite: true,
      confirm: true,
    });
    const job = (await env.DB.prepare("SELECT * FROM jobs WHERE id=?")
      .bind(jobId)
      .first<Job>())!;
    expect(job.caption).toBe("Snapshot");
    expect(job.cover_id).toBe(id);
    expect((await row("a"))?.caption).toBe("Changed");
    const signed = new URL(await coverUrl(env, jobId, job.media_expires_at));
    expect(
      (await request(signed.pathname + signed.search, "GET", undefined, false))
        .status,
    ).toBe(200);
    const videoSigned = new URL(
      await mediaUrl(env, jobId, job.media_expires_at),
    );
    expect(
      (
        await request(
          signed.pathname + videoSigned.search,
          "GET",
          undefined,
          false,
        )
      ).status,
    ).toBe(403);
    expect((await request(`/api/covers/${id}`, "DELETE")).status).toBe(409);
    const a = adapter();
    await tick(env, a);
    expect(a.createContainer.mock.calls[0]).toEqual([
      "123",
      "test-token-only",
      expect.any(String),
      "Snapshot",
      { cover_url: expect.stringContaining("/cover-media/") },
    ]);
    advance(86400001);
    expect(
      (await request(signed.pathname + signed.search, "GET", undefined, false))
        .status,
    ).toBe(403);
    expect(
      (await env.DB.prepare("SELECT enabled FROM settings").first())?.enabled,
    ).toBe(0);
  });
  it("preserves assigned defaults when the queue loops back", async () => {
    await video("a", 0);
    await video("b", 1);
    await request("/api/bulk/defaults", "PATCH", { caption: "Every loop" });
    await request("/api/bulk/apply", "POST", { caption: "default" });
    const videos = (await env.DB.prepare("SELECT * FROM videos").all<Video>())
      .results;
    const settings = (await env.DB.prepare(
      "SELECT * FROM settings",
    ).first<Settings>())!;
    settings.last_video_id = "b";
    const next = selectNext(videos, settings, now);
    expect(next?.id).toBe("a");
    expect(next?.caption).toBe("Every loop");
  });
  it("rejects unauthorized mutations and private image previews", async () => {
    expect(
      (
        await request(
          "/api/bulk/defaults",
          "PATCH",
          { caption: "attack" },
          false,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          "/api/covers",
          "POST",
          { name: "a", size_bytes: 20 },
          false,
        )
      ).status,
    ).toBe(401);
    const id = await savedCover();
    expect(
      (await request(`/api/covers/${id}/preview`, "GET", undefined, false))
        .status,
    ).toBe(401);
    expect(
      (await env.DB.prepare("SELECT default_caption FROM settings").first())
        ?.default_caption,
    ).toBe("");
  });
  it("rejects invalid image content and leaves defaults unchanged", async () => {
    const res = await request("/api/covers", "POST", {
      name: "bad.jpg",
      size_bytes: 40,
    });
    const { id } = (await res.json()) as { id: string };
    await env.VIDEOS.put(`staging/covers/${id}`, new Uint8Array(40), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    expect(
      (await request(`/api/covers/${id}/complete`, "POST", {})).status,
    ).toBe(400);
    expect(
      (await request("/api/bulk/defaults", "PATCH", { cover_id: id })).status,
    ).toBe(409);
    expect(
      (
        await env.DB.prepare("SELECT status FROM covers WHERE id=?")
          .bind(id)
          .first()
      )?.status,
    ).toBe("uploading");
    expect(
      (
        await request("/api/covers", "POST", {
          name: "large.jpg",
          size_bytes: 2000001,
        })
      ).status,
    ).toBe(400);
    expect(jpegDimensions(jpeg)).toEqual({ width: 320, height: 480 });
    expect(() => jpegDimensions(jpeg.slice(0, -2))).toThrow();
  });
  it("rolls back both bulk fields when a database write fails", async () => {
    await video("a");
    const id = await savedCover();
    await request("/api/bulk/defaults", "PATCH", {
      caption: "new",
      cover_id: id,
    });
    await env.DB.prepare(
      "CREATE TRIGGER reject_bulk BEFORE UPDATE OF cover_id ON videos BEGIN SELECT RAISE(ABORT,'test'); END",
    ).run();
    try {
      expect(
        (
          await request("/api/bulk/apply", "POST", {
            caption: "default",
            cover: "default",
          })
        ).status,
      ).toBe(500);
      expect((await row("a"))?.caption).toBe("");
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_bulk").run();
    }
  });
  it("validates the full combined caption including embedded hashtags, mentions and emoji", () => {
    expect(captionText.safeParse("✨".repeat(2200)).success).toBe(true);
    expect(captionText.safeParse("a".repeat(2201)).success).toBe(false);
    expect(captionText.safeParse("#tag ".repeat(31)).success).toBe(false);
    expect(captionText.safeParse("@user ".repeat(21)).success).toBe(false);
  });
});
