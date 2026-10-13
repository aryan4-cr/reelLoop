import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  init,
  reset,
  mf,
  env,
  now,
  advance,
  account,
  video,
  start,
  job,
  settings,
  adapter,
} from "./fixture";
import { tick, complete } from "../worker/scheduler";
import { withLease } from "../worker/lease";
import { MetaError } from "../worker/instagram";
describe("persistent scheduler on D1", () => {
  beforeAll(init);
  beforeEach(reset);
  afterAll(async () => {
    await mf.dispose();
  });
  it("is paused by default and does not call Instagram", async () => {
    const a = adapter();
    await account();
    await video();
    await tick(env, a);
    expect(a.createContainer).not.toHaveBeenCalled();
    expect((await settings()).enabled).toBe(0);
  });
  it("publishes only after processing, retains video and schedules three hours later", async () => {
    await start();
    const a = adapter();
    await tick(env, a);
    expect((await job()).state).toBe("processing");
    expect(a.publish).not.toHaveBeenCalled();
    await tick(env, a);
    expect(a.status).not.toHaveBeenCalled();
    advance();
    await tick(env, a);
    expect((await job()).state).toBe("ready");
    await tick(env, a);
    expect((await job()).state).toBe("succeeded");
    expect((await job()).media_id).toBe("media-1");
    expect((await settings()).next_publish_at).toBe(
      1800000000000 + 180 * 60000,
    );
    expect(await env.DB.prepare("SELECT id FROM videos").first()).toBeTruthy();
  });
  it("pauses between container creation and publication and resumes the same container", async () => {
    await start();
    const a = adapter();
    await tick(env, a);
    await env.DB.prepare("UPDATE settings SET enabled=0 WHERE id=1").run();
    advance();
    await tick(env, a);
    expect(a.status).not.toHaveBeenCalled();
    await env.DB.prepare("UPDATE settings SET enabled=1 WHERE id=1").run();
    await tick(env, a);
    await tick(env, a);
    expect(a.createContainer).toHaveBeenCalledTimes(1);
    expect(a.publish).toHaveBeenCalledTimes(1);
  });
  it("does not advance the cursor for processing delays", async () => {
    await start();
    const a = adapter();
    a.status.mockResolvedValue("IN_PROGRESS");
    await tick(env, a);
    advance();
    await tick(env, a);
    expect((await job()).state).toBe("processing");
    expect((await settings()).cursor_position).toBe(-1);
    expect(a.publish).not.toHaveBeenCalled();
  });
  it("records failed container creation and pauses after three failed jobs", async () => {
    await start();
    const a = adapter();
    a.createContainer.mockRejectedValue(new MetaError(400, false));
    for (let i = 0; i < 3; i++) {
      await tick(env, a);
      advance(3600001);
    }
    expect((await settings()).enabled).toBe(0);
    expect((await settings()).failure_streak).toBe(3);
    expect(a.publish).not.toHaveBeenCalled();
  });
  it("backs off transient errors and does not create concurrent retries", async () => {
    await start();
    const a = adapter();
    a.createContainer.mockRejectedValueOnce(new MetaError(500, true, true));
    await tick(env, a);
    const failed = await job();
    expect(failed.state).toBe("creating");
    expect(failed.retry_at).toBeGreaterThan(now);
    await Promise.all([tick(env, a), tick(env, a)]);
    expect(a.createContainer).toHaveBeenCalledTimes(1);
    advance();
    await tick(env, a);
    expect(a.createContainer).toHaveBeenCalledTimes(2);
    expect((await job()).state).toBe("processing");
  });
  it("halts on ambiguous publication and never resubmits", async () => {
    await start();
    const a = adapter();
    a.publish.mockRejectedValue(new MetaError(0, true, true));
    await tick(env, a);
    advance();
    await tick(env, a);
    await tick(env, a);
    expect((await job()).state).toBe("uncertain");
    expect((await settings()).enabled).toBe(0);
    await tick(env, a);
    advance(10000000);
    await tick(env, a);
    expect(a.publish).toHaveBeenCalledTimes(1);
  });
  it("recovers a crash after publishing intent without sending another POST", async () => {
    await start();
    const a = adapter();
    await tick(env, a);
    await env.DB.prepare("UPDATE jobs SET state='publishing'").run();
    await tick(env, a);
    expect((await job()).state).toBe("uncertain");
    expect(a.publish).not.toHaveBeenCalled();
  });
  it("uses an atomic account lease for overlapping cron invocations", async () => {
    await start();
    const a = adapter();
    await Promise.all(Array.from({ length: 8 }, () => tick(env, a)));
    expect(a.createContainer).toHaveBeenCalledTimes(1);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM jobs").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  });
  it("enforces one active job with a database constraint", async () => {
    await start();
    await tick(env, adapter());
    await expect(
      env.DB.prepare(
        "INSERT INTO jobs(id,video_name,object_key,caption,scheduled_at,created_at,state,media_expires_at,account_id,position) VALUES('other','other','other','',0,0,'queued',999,'123',0)",
      ).run(),
    ).rejects.toThrow();
  });
  it("pauses when authentication is missing, expired or revoked", async () => {
    await video();
    await env.DB.prepare(
      "UPDATE settings SET enabled=1,next_publish_at=0",
    ).run();
    const a = adapter();
    await tick(env, a);
    expect((await settings()).enabled).toBe(0);
    await account();
    await env.DB.prepare("UPDATE accounts SET expires_at=0").run();
    await env.DB.prepare("UPDATE settings SET enabled=1").run();
    await tick(env, a);
    expect(a.createContainer).not.toHaveBeenCalled();
    await env.DB.prepare("UPDATE accounts SET expires_at=?")
      .bind(now + 86400000 * 30)
      .run();
    await env.DB.prepare("UPDATE settings SET enabled=1").run();
    a.quota.mockRejectedValue(new MetaError(190, false));
    await tick(env, a);
    expect((await settings()).enabled).toBe(0);
    expect(
      (
        await env.DB.prepare("SELECT status FROM accounts").first<{
          status: string;
        }>()
      )?.status,
    ).toBe("reauth_required");
  });
  it("delays when the provider quota is full", async () => {
    await start();
    const a = adapter();
    a.quota.mockResolvedValue({ used: 100, total: 100 });
    await tick(env, a);
    expect(a.createContainer).not.toHaveBeenCalled();
    expect((await job()).retry_at).toBe(now + 3600000);
  });
  it("honors Retry-After from rate limits", async () => {
    await start();
    const a = adapter();
    a.quota.mockRejectedValue(new MetaError(429, true, false, 7200000));
    await tick(env, a);
    expect((await job()).retry_at).toBe(now + 7200000);
  });
  it("does not select incomplete uploads and pauses an empty queue", async () => {
    await account();
    await video("pending", 0, "uploading");
    await env.DB.prepare(
      "UPDATE settings SET enabled=1,next_publish_at=0",
    ).run();
    const a = adapter();
    await tick(env, a);
    expect(a.createContainer).not.toHaveBeenCalled();
    expect((await settings()).enabled).toBe(0);
  });
  it("loops after the last video and survives removals and new videos", async () => {
    await start();
    await video("b", 1);
    const a = adapter();
    for (const expected of ["a", "b", "a"]) {
      await tick(env, a);
      expect((await job()).video_id).toBe(expected);
      advance();
      await tick(env, a);
      await tick(env, a);
      const s = await settings();
      advance(s.next_publish_at! - now);
    }
    await env.DB.prepare("DELETE FROM videos WHERE id='a'").run();
    await video("c", 2);
    await tick(env, a);
    expect((await job()).video_id).toBe("b");
  });
  it("publish-once pauses after the eligible queue is exhausted", async () => {
    await start();
    await env.DB.prepare("UPDATE settings SET mode='once'").run();
    const a = adapter();
    await tick(env, a);
    advance();
    await tick(env, a);
    await tick(env, a);
    advance(180 * 60000);
    await tick(env, a);
    expect((await settings()).enabled).toBe(0);
    expect(a.publish).toHaveBeenCalledTimes(1);
  });
  it("reconciliation is idempotent and does not increment counts twice", async () => {
    await start();
    const a = adapter();
    await tick(env, a);
    advance();
    await tick(env, a);
    await env.DB.prepare("UPDATE jobs SET state='uncertain'").run();
    const j = await job();
    await withLease(env, async (l) => {
      await complete(env, l, j, "12345");
      await complete(env, l, j, "12345");
    });
    expect(
      (
        await env.DB.prepare("SELECT publish_count FROM videos").first<{
          publish_count: number;
        }>()
      )?.publish_count,
    ).toBe(1);
  });
  it("rejects a stale lease before publishing a response is recorded", async () => {
    await start();
    const a = adapter();
    await tick(env, a);
    advance();
    await tick(env, a);
    a.publish.mockImplementation(async () => {
      advance(121000);
      return "media";
    });
    await expect(tick(env, a)).rejects.toThrow("lease expired");
    expect((await job()).state).toBe("publishing");
    await tick(env, a);
    expect((await job()).state).toBe("uncertain");
  });

  it("honors pause arriving while the final quota request is in flight", async () => {
    await start();
    const a = adapter();
    await tick(env, a);
    advance();
    await tick(env, a);
    a.quota.mockImplementation(async () => {
      await env.DB.prepare("UPDATE settings SET enabled=0").run();
      return { used: 0, total: 100 };
    });
    await tick(env, a);
    expect(a.publish).not.toHaveBeenCalled();
    expect((await job()).state).toBe("ready");
  });
  it("submits only once when eight publish ticks overlap", async () => {
    await start();
    const a = adapter();
    await tick(env, a);
    advance();
    await tick(env, a);
    await Promise.all(Array.from({ length: 8 }, () => tick(env, a)));
    expect(a.publish).toHaveBeenCalledTimes(1);
    expect((await job()).state).toBe("succeeded");
  });
  it("expires an old unpublished job before another provider operation", async () => {
    await start();
    const a = adapter();
    await tick(env, a);
    advance(86400001);
    await tick(env, a);
    expect((await job()).state).toBe("failed");
    expect(a.publish).not.toHaveBeenCalled();
    expect(a.status).not.toHaveBeenCalled();
  });
  it("bounds retries when provider quota calls keep failing", async () => {
    await start();
    const a = adapter();
    a.quota.mockRejectedValue(new MetaError(429, true));
    for (let i = 0; i < 5; i++) {
      await tick(env, a);
      const j = await job();
      if (j.retry_at > now) advance(j.retry_at - now);
    }
    expect((await job()).state).toBe("failed");
    expect(a.createContainer).not.toHaveBeenCalled();
  });
  it("records processing errors without attempting publication", async () => {
    await start();
    const a = adapter();
    a.status.mockResolvedValue("ERROR");
    await tick(env, a);
    advance();
    await tick(env, a);
    expect((await job()).state).toBe("failed");
    expect(a.publish).not.toHaveBeenCalled();
  });
  it("refreshes a valid near-expiry token and stores encrypted replacement", async () => {
    await start();
    await env.DB.prepare("UPDATE accounts SET expires_at=?,refreshed_at=?")
      .bind(now + 2 * 86400000, now - 2 * 86400000)
      .run();
    const a = adapter();
    await tick(env, a);
    expect(a.refresh).toHaveBeenCalledTimes(1);
    const saved = await env.DB.prepare(
      "SELECT token_cipher,expires_at FROM accounts",
    ).first<{ token_cipher: string; expires_at: number }>();
    expect(saved?.expires_at).toBe(now + 60 * 86400000);
    expect(saved?.token_cipher).not.toContain("refreshed-test-token");
  });
});
