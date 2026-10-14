import { afterEach, describe, expect, it, vi } from "vitest";
import { api, finalizeUpload, uploadFile } from "../src/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function browser() {
  vi.stubGlobal("document", {
    createElement: () => ({
      duration: 5,
      videoWidth: 1080,
      videoHeight: 1920,
      onloadedmetadata: () => {},
      removeAttribute() {},
      load() {},
      set src(_: string) {
        queueMicrotask(() => this.onloadedmetadata());
      },
    }),
  });
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      upload = {};
      status = 200;
      onload = () => {};
      open() {}
      setRequestHeader() {}
      getResponseHeader() {
        return '"test-etag"';
      }
      send() {
        queueMicrotask(() => this.onload());
      }
    },
  );
}
describe("upload client recovery", () => {
  it.each([false, true])(
    "retains completed bytes after finalization failure (multipart=%s), then retries",
    async (multipart) => {
      browser();
      let fail = true;
      const requests: Array<{ path: string; method: string; body?: string }> =
        [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string, init: RequestInit) => {
          requests.push({
            path,
            method: init.method!,
            body: init.body as string,
          });
          if (path === "/api/uploads")
            return Response.json({
              id: "client-test",
              multipart,
              parts: 2,
              part_size: 16,
              url: "https://test.invalid",
            });
          if (path.endsWith("/part"))
            return Response.json({ url: "https://test.invalid" });
          if (path.endsWith("/complete"))
            return fail
              ? Response.json(
                  { error: "Upload promotion failed." },
                  { status: 500 },
                )
              : Response.json({ ok: true });
          throw new Error("Unexpected cleanup");
        }),
      );
      await expect(
        uploadFile(new File([new Uint8Array(32)], "test.mp4"), () => {}),
      ).rejects.toThrow("retained");
      expect(requests.some((r) => r.method === "DELETE")).toBe(false);
      fail = false;
      await finalizeUpload("client-test");
      const completions = requests.filter((r) => r.path.endsWith("/complete"));
      expect(completions).toHaveLength(2);
      expect(completions[1].body).toBe(completions[0].body);
      if (multipart)
        expect(JSON.parse(completions[1].body!).parts).toHaveLength(2);
    },
  );
  it("handles an HTML Worker error without exposing its content", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html>private-request-details</html>", { status: 500 }),
    );
    await expect(api("/dashboard")).rejects.toThrow("HTTP 500");
    await expect(api("/dashboard")).rejects.not.toThrow(
      "private-request-details",
    );
  });
});
