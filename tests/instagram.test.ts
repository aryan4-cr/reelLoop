import { describe, it, expect, vi } from "vitest";
import { Instagram, MetaError } from "../worker/instagram";
import type { Env } from "../worker/types";
const env = {
  META_API_VERSION: "v25.0",
  META_APP_ID: "test-app",
  META_APP_SECRET: "test-secret",
  PUBLIC_ORIGIN: "https://example.test",
} as Env;
describe("official Instagram adapter with HTTP mocks", () => {
  it("uses the Instagram host, minimal publishing fields and bearer tokens", async () => {
    const f = vi.fn(async () => Response.json({ id: "container" }));
    const a = new Instagram(env, f as typeof fetch);
    expect(
      await a.createContainer(
        "123",
        "token",
        "https://example.test/media/abc",
        "Caption",
      ),
    ).toBe("container");
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe("https://graph.instagram.com");
    expect(url.pathname).toBe("/v25.0/123/media");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token");
    expect(String(init.body)).toContain("media_type=REELS");
  });
  it("separates container creation, processing status and publishing", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "container" }))
      .mockResolvedValueOnce(Response.json({ status_code: "IN_PROGRESS" }))
      .mockResolvedValueOnce(Response.json({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(Response.json({ id: "published-media" }));
    const a = new Instagram(env, f);
    expect(
      await a.createContainer("123", "t", "https://example.test/a", "c"),
    ).toBe("container");
    expect(await a.status("container", "t")).toBe("IN_PROGRESS");
    expect(await a.status("container", "t")).toBe("FINISHED");
    expect(await a.publish("123", "t", "container")).toBe("published-media");
    expect(String(f.mock.calls[3][1].body)).toBe("creation_id=container");
  });
  it("does not invent success for malformed or interrupted publish responses", async () => {
    for (const f of [
      vi.fn(async () => Response.json({})),
      vi.fn(async () => {
        throw new Error("network");
      }),
    ]) {
      try {
        await new Instagram(env, f as typeof fetch).publish("123", "t", "c");
        throw new Error("Expected failure");
      } catch (e) {
        expect(e).toBeInstanceOf(MetaError);
        expect((e as MetaError).ambiguous).toBe(true);
      }
    }
  });
  it("sanitizes provider errors, handles revocation and honors rate limit delay", async () => {
    const f = vi.fn(async () =>
      Response.json(
        { error: { code: 190, message: "private-token-sensitive" } },
        { status: 400 },
      ),
    );
    await expect(
      new Instagram(env, f as typeof fetch).status(
        "c",
        "private-token-sensitive",
      ),
    ).rejects.toThrow("revoked");
    const r = vi.fn(async () =>
      Response.json(
        { error: { code: 4 } },
        { status: 429, headers: { "Retry-After": "120" } },
      ),
    );
    try {
      await new Instagram(env, r as typeof fetch).quota("123", "t");
    } catch (e) {
      expect((e as MetaError).retryAfter).toBe(120000);
      expect((e as MetaError).retryable).toBe(true);
    }
  });
  it("exchanges a short-lived login token for a long-lived token and discovers the account", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: "short", user_id: 123 }),
      )
      .mockResolvedValueOnce(
        Response.json({ access_token: "long", expires_in: 5184000 }),
      )
      .mockResolvedValueOnce(
        Response.json({ user_id: "123", username: "creator" }),
      );
    const out = await new Instagram(env, f).exchange("code");
    expect(out.id).toBe("123");
    expect(out.access_token).toBe("long");
    expect(f.mock.calls[0][0]).toBe(
      "https://api.instagram.com/oauth/access_token",
    );
    expect(new URL(f.mock.calls[1][0]).searchParams.get("grant_type")).toBe(
      "ig_exchange_token",
    );
  });
});
