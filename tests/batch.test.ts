import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import {
  init,
  reset,
  mf,
  env,
  now,
  advance,
  account,
  video,
  settings,
  adapter,
} from "./fixture";
import { tick } from "../worker/scheduler";
import { activeBatch, cancelBatch, batchVolume } from "../worker/batches";
import { withLease } from "../worker/lease";
import { upcoming } from "../worker/queue";
import { Instagram, MetaError } from "../worker/instagram";
import { app } from "../worker/index";
import type { Job, Video } from "../worker/types";
async function setup(interval = 300) {
  await account();
  for (let i = 0; i < 4; i++) await video(String(i), i);
  await env.DB.prepare(
    "UPDATE settings SET batch_enabled=1,interval_minutes=?,enabled=1,next_publish_at=?",
  )
    .bind(interval, now)
    .run();
}
async function current() {
  return env.DB.prepare(
    "SELECT * FROM jobs WHERE state IN('queued','creating','processing','ready','publishing','uncertain')",
  ).first<Job>();
}
async function finishOne(a: ReturnType<typeof adapter>) {
  await tick(env, a);
  advance();
  await tick(env, a);
  advance();
  await tick(env, a);
  advance();
}
describe("persistent sequential Batch Loop", () => {
  beforeAll(init);
  beforeEach(reset);
  afterAll(() => mf.dispose());
  it("snapshots four videos, captions and covers; publishes sequentially and repeats every five hours", async () => {
    await setup();
    const anchor = now;
    await env.VIDEOS.put("covers/shared", "image");
    await env.DB.prepare(
      "INSERT INTO covers(id,object_key,name,size_bytes,width,height,status,created_at) VALUES('cover','covers/shared','shared',5,320,320,'ready',0)",
    ).run();
    await env.DB.prepare(
      "UPDATE videos SET caption='Original',hashtags='#saved',cover_id='cover'",
    ).run();
    const a = adapter();
    let media = 0;
    a.publish.mockImplementation(async () => `media-${++media}`);
    await tick(env, a);
    expect(
      (await env.DB.prepare("SELECT count(*) n FROM batch_items").first<{
        n: number;
      }>())!.n,
    ).toBe(4);
    await env.DB.prepare(
      "UPDATE videos SET caption='Changed',cover_id=NULL,enabled=0 WHERE id='3'",
    ).run();
    advance();
    await tick(env, a);
    advance();
    await tick(env, a);
    advance();
    for (let i = 1; i < 4; i++) await finishOne(a);
    await tick(env, a);
    expect(a.publish).toHaveBeenCalledTimes(4);
    const jobs = (
      await env.DB.prepare("SELECT * FROM jobs ORDER BY position").all<Job>()
    ).results;
    expect(jobs.map((j) => j.video_id)).toEqual(["0", "1", "2", "3"]);
    expect(
      jobs.every(
        (j) =>
          j.caption === "Original\n\n#saved" &&
          j.cover_id === "cover" &&
          j.state === "succeeded",
      ),
    ).toBe(true);
    expect(await activeBatch(env)).toBeNull();
    expect((await settings()).next_publish_at).toBe(anchor + 300 * 60000);
    advance(anchor + 300 * 60000 - now);
    await tick(env, a);
    expect(
      (await env.DB.prepare("SELECT count(*) n FROM batches").first<{
        n: number;
      }>())!.n,
    ).toBe(2);
    expect((await current())!.video_id).toBe("0"); // New snapshot reflects disabled video; prior snapshot did not.
    expect(await env.VIDEOS.head("covers/shared")).toBeTruthy();
  });
  it("retains three-hour batch spacing when configured and groups all four in previews", async () => {
    await setup(180);
    const anchor = now;
    const a = adapter();
    for (let i = 0; i < 4; i++) await finishOne(a);
    await tick(env, a);
    expect((await settings()).next_publish_at).toBe(anchor + 180 * 60000);
    const rows = (await env.DB.prepare("SELECT * FROM videos").all<Video>())
      .results;
    const preview = upcoming(rows, await settings(), now);
    expect(preview.slice(0, 4).map((v) => v.id)).toEqual(["0", "1", "2", "3"]);
    expect(preview[0].batch_at).toBe(preview[3].batch_at);
    expect(preview[4].batch_at! - preview[0].batch_at!).toBe(180 * 60000);
    expect(batchVolume(4, 300)).toEqual({ average: 19.2, maximum: 20 });
  });
  it("pauses/resumes the same persisted container after a runtime restart", async () => {
    await setup();
    const first = adapter();
    await tick(env, first);
    const id = (await current())!.id;
    await env.DB.prepare("UPDATE settings SET enabled=0").run();
    advance();
    const restarted = adapter();
    await tick(env, restarted);
    expect(restarted.status).not.toHaveBeenCalled();
    expect(restarted.publish).not.toHaveBeenCalled();
    await env.DB.prepare("UPDATE settings SET enabled=1").run();
    await tick(env, restarted);
    advance();
    await tick(env, restarted);
    expect(restarted.createContainer).not.toHaveBeenCalled();
    expect(
      (await env.DB.prepare("SELECT state FROM jobs WHERE id=?")
        .bind(id)
        .first<{ state: string }>())!.state,
    ).toBe("succeeded");
  });
  it("does not overlap or catch up after a batch extends beyond its boundary", async () => {
    await setup(60);
    const anchor = now;
    const a = adapter();
    await tick(env, a);
    advance(2 * 3600000);
    await tick(env, a);
    advance();
    await tick(env, a);
    advance();
    for (let i = 1; i < 4; i++) await finishOne(a);
    await tick(env, a);
    expect((await settings()).next_publish_at).toBe(anchor + 3 * 3600000);
    await tick(env, a);
    expect(a.publish).toHaveBeenCalledTimes(4);
    expect(
      (await env.DB.prepare("SELECT count(*) n FROM batches").first<{
        n: number;
      }>())!.n,
    ).toBe(1);
  });
  it("continues after a failed item, while preserving failure history", async () => {
    await setup();
    const a = adapter();
    a.createContainer.mockRejectedValueOnce(new MetaError(400, false));
    await tick(env, a);
    advance();
    await finishOne(a);
    const jobs = (
      await env.DB.prepare("SELECT state FROM jobs ORDER BY position").all<{
        state: string;
      }>()
    ).results;
    expect(jobs.map((j) => j.state)).toEqual(["failed", "succeeded"]);
    expect(a.publish).toHaveBeenCalledTimes(1);
  });
  it("waits through processing delays and quota exhaustion without publishing", async () => {
    await setup();
    const a = adapter();
    a.quota.mockResolvedValue({ used: 99, total: 100, windowSeconds: 86400 });
    await tick(env, a);
    expect(await activeBatch(env)).toBeNull();
    expect((await settings()).enabled).toBe(0);
    a.quota.mockResolvedValue({ used: 0, total: 100, windowSeconds: 86400 });
    await env.DB.prepare("UPDATE settings SET enabled=1").run();
    await tick(env, a);
    a.status.mockResolvedValueOnce("IN_PROGRESS");
    advance();
    await tick(env, a);
    expect((await current())!.state).toBe("processing");
    advance();
    await tick(env, a);
    a.quota.mockResolvedValue({ used: 100, total: 100 });
    advance();
    await tick(env, a);
    expect(a.publish).not.toHaveBeenCalled();
    expect((await current())!.state).toBe("ready");
  });
  it("rechecks changed quota limits before a recurring batch, without creating new jobs", async () => {
    await setup();
    const a = adapter();
    for (let i = 0; i < 4; i++) await finishOne(a);
    await tick(env, a);
    const due = (await settings()).next_publish_at!;
    advance(due - now);
    a.quota.mockResolvedValue({ used: 0, total: 10, windowSeconds: 86400 });
    await tick(env, a);
    expect((await settings()).enabled).toBe(0);
    expect(await activeBatch(env)).toBeNull();
    expect(a.publish).toHaveBeenCalledTimes(4);
    expect(
      (await env.DB.prepare("SELECT count(*) n FROM jobs").first<{
        n: number;
      }>())!.n,
    ).toBe(4);
  });
  it("blocks batch execution when the provider quota window is missing", async () => {
    await setup();
    const a = adapter();
    a.quota.mockResolvedValue({ used: 0, total: 100 });
    await tick(env, a);
    expect((await settings()).enabled).toBe(0);
    expect(await activeBatch(env)).toBeNull();
    expect(a.createContainer).not.toHaveBeenCalled();
  });
  it("fences concurrent ticks and never retries an uncertain publish or starts another item", async () => {
    await setup();
    const a = adapter();
    await Promise.all([tick(env, a), tick(env, a)]);
    expect(a.createContainer).toHaveBeenCalledTimes(1);
    advance();
    await tick(env, a);
    a.publish.mockRejectedValue(new Error("interrupted"));
    advance();
    await tick(env, a);
    expect((await current())!.state).toBe("uncertain");
    expect((await settings()).enabled).toBe(0);
    await tick(env, a);
    await expect(withLease(env, (l) => cancelBatch(env, l))).rejects.toThrow(
      "Reconcile",
    );
    expect(a.publish).toHaveBeenCalledTimes(1);
    expect(a.createContainer).toHaveBeenCalledTimes(1);
  });
  it("cancels only unpublished remainder and preserves originals and completed results", async () => {
    await setup();
    const a = adapter();
    await finishOne(a);
    await tick(env, a);
    await withLease(env, (l) => cancelBatch(env, l));
    expect(await activeBatch(env)).toBeNull();
    expect((await settings()).enabled).toBe(0);
    expect(
      (await env.DB.prepare("SELECT count(*) n FROM videos").first<{
        n: number;
      }>())!.n,
    ).toBe(4);
    const states = (
      await env.DB.prepare("SELECT state FROM jobs ORDER BY position").all<{
        state: string;
      }>()
    ).results;
    expect(states.map((j) => j.state)).toEqual(["succeeded", "skipped"]);
    await tick(env, a);
    expect(a.publish).toHaveBeenCalledTimes(1);
  });
  it("honors cooldowns without silently changing them and blocks deletion of pending snapshots", async () => {
    await setup();
    await env.DB.prepare("UPDATE videos SET last_published_at=?")
      .bind(now)
      .run();
    await env.DB.prepare("UPDATE settings SET cooldown_minutes=60").run();
    const a = adapter();
    await tick(env, a);
    expect(await activeBatch(env)).toBeNull();
    expect((await settings()).next_publish_at).toBe(now + 3600000);
    advance(3600000);
    await tick(env, a);
    expect(await activeBatch(env)).toBeTruthy();
    expect((await settings()).cooldown_minutes).toBe(60);
  });
  it("requires authenticated explicit confirmation and checks live quota before enabling", async () => {
    await setup();
    await env.DB.prepare("UPDATE settings SET enabled=0").run();
    const login = await app.fetch(
      new Request(env.APP_ORIGIN + "/api/auth/login", {
        method: "POST",
        headers: { Origin: env.APP_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-only" }),
      }),
      env,
    );
    const csrf = ((await login.json()) as { csrf: string }).csrf;
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const request = (
      path: string,
      body: unknown,
      auth = true,
      method = "POST",
    ) =>
      app.fetch(
        new Request(env.APP_ORIGIN + path, {
          method,
          headers: {
            Origin: env.APP_ORIGIN,
            "Content-Type": "application/json",
            ...(auth ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
          },
          body: JSON.stringify(body),
        }),
        env,
      );
    const quota = vi
      .spyOn(Instagram.prototype, "quota")
      .mockResolvedValue({ used: 0, total: 100, windowSeconds: 86400 });
    expect((await request("/api/schedule/start", {}, false)).status).toBe(401);
    expect((await request("/api/schedule/start", {})).status).toBe(409);
    expect(quota).not.toHaveBeenCalled();
    quota.mockResolvedValue({ used: 0, total: 10, windowSeconds: 86400 });
    expect(
      (
        await request("/api/schedule/start", {
          batch_confirmation: "START BATCH LOOP",
        })
      ).status,
    ).toBe(409);
    quota.mockResolvedValue({ used: 0, total: 100, windowSeconds: 86400 });
    expect(
      (
        await request("/api/schedule/start", {
          batch_confirmation: "START BATCH LOOP",
        })
      ).status,
    ).toBe(200);
    expect((await settings()).enabled).toBe(1);
    await request("/api/schedule/pause", {});
    await tick(env, adapter());
    expect(await activeBatch(env)).toBeNull();
    await env.DB.prepare("UPDATE settings SET enabled=1").run();
    await tick(env, adapter());
    await request("/api/schedule/pause", {});
    expect(
      (await request("/api/videos/3", undefined, true, "DELETE")).status,
    ).toBe(409);
    expect(
      (
        await request(
          "/api/settings",
          {
            interval_minutes: 300,
            timezone: "Asia/Kolkata",
            mode: "batch",
            cooldown_minutes: 0,
          },
          true,
          "PATCH",
        )
      ).status,
    ).toBe(409);
  });
});
