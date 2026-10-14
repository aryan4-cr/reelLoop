// Owner-run live checks. Password/session/signed URLs stay in memory.
// Only a disposable staging probe is uploaded; it is never finalized or published.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const origin = "https://my-worker.reelloop.workers.dev";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const report = { at: new Date().toISOString(), origin, checks: [] };
let cookie, csrf, probeId;
function record(name, passed, status) {
  report.checks.push({
    name,
    passed,
    ...(status === undefined ? {} : { status }),
  });
  console.log(
    `${passed ? "PASS" : "FAIL"}: ${name}${status === undefined ? "" : ` (HTTP ${status})`}`,
  );
  if (!passed) throw new Error("Check failed");
}
async function request(path, method = "GET", body, extra = {}) {
  return fetch(origin + path, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method !== "GET"
        ? {
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf || "",
          }
        : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function passwordPrompt() {
  if (!process.stdin.isTTY) throw new Error("Interactive terminal required");
  process.stdout.write(
    "ReelLoop owner password (hidden; sent only to your HTTPS Worker): ",
  );
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const onData = (data) => {
      for (const char of data.toString("utf8")) {
        if (char === "\u0003") {
          process.stdin.setRawMode(false);
          process.exit(1);
        }
        if (char === "\r" || char === "\n") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}
try {
  const page = await request("/");
  record(
    "HTTPS dashboard and HSTS",
    page.status === 200 && !!page.headers.get("strict-transport-security"),
    page.status,
  );
  const anonymous = await request("/api/dashboard");
  record(
    "Anonymous dashboard blocked",
    anonymous.status === 401,
    anonymous.status,
  );
  const password = await passwordPrompt();
  const login = await request("/api/auth/login", "POST", { password });
  record("Owner login on Workers Free", login.status === 200, login.status);
  const header = login.headers.get("set-cookie") || "";
  cookie = header.split(";")[0];
  csrf = (await login.json()).csrf;
  record(
    "Secure HttpOnly SameSite=Lax session cookie",
    /;\s*Secure(?:;|$)/i.test(header) &&
      /;\s*HttpOnly/i.test(header) &&
      /;\s*SameSite=Lax/i.test(header),
  );
  const dashboard = await request("/api/dashboard");
  record(
    "Authenticated dashboard / D1",
    dashboard.status === 200,
    dashboard.status,
  );
  const data = await dashboard.json();
  record(
    "Publishing paused and 8 GB reservation cap",
    data.settings.enabled === 0 &&
      data.settings.next_publish_at === null &&
      data.storage.limit === 8000000000,
  );
  record(
    "R2 and Meta configuration present",
    data.configuration.uploads && data.configuration.instagram,
  );
  const denied = await request(
    "/api/uploads",
    "POST",
    {},
    { "X-CSRF-Token": "invalid" },
  );
  record("Invalid CSRF rejected", denied.status === 403, denied.status);
  const wrongOrigin = await request(
    "/api/uploads",
    "POST",
    {},
    { Origin: "https://example.invalid" },
  );
  record(
    "Foreign Origin rejected",
    wrongOrigin.status === 403,
    wrongOrigin.status,
  );
  const probe = await request("/api/uploads", "POST", {
    name: "reelloop-disposable-connectivity-probe.mp4",
    content_type: "video/mp4",
    size_bytes: 32,
    duration_seconds: 3,
    width: 320,
    height: 320,
  });
  record(
    "Upload reservation and signing on Workers Free",
    probe.status === 201,
    probe.status,
  );
  const upload = await probe.json();
  probeId = upload.id;
  const signed = new URL(upload.url);
  record(
    "Signed upload targets this account's R2",
    signed.protocol === "https:" &&
      ((signed.hostname ===
        "d0b25c7d1d5d01fe584982892e6a4e94.r2.cloudflarestorage.com" &&
        signed.pathname === `/reelloop-videos/staging/${probeId}`) ||
        (signed.hostname ===
          "reelloop-videos.d0b25c7d1d5d01fe584982892e6a4e94.r2.cloudflarestorage.com" &&
          signed.pathname === `/staging/${probeId}`)),
  );
  const preflight = await fetch(signed, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
    signal: AbortSignal.timeout(30000),
  });
  record(
    "Live signed-upload CORS",
    preflight.ok &&
      preflight.headers.get("access-control-allow-origin") === origin,
    preflight.status,
  );
  const put = await fetch(signed, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", Origin: origin },
    body: new Uint8Array(32),
    signal: AbortSignal.timeout(30000),
  });
  record(
    "R2 S3 credential accepted disposable staging PUT",
    put.ok && !!put.headers.get("etag"),
    put.status,
  );
  const cleaned = await request(`/api/uploads/${probeId}`, "DELETE");
  record(
    "R2 binding and D1 staging cleanup",
    cleaned.status === 200,
    cleaned.status,
  );
  probeId = undefined;
  const after = await (await request("/api/dashboard")).json();
  record(
    "Probe removed and publishing remains paused",
    !after.videos.some(
      (v) => v.name === "reelloop-disposable-connectivity-probe.mp4",
    ) && after.settings.enabled === 0,
  );
} catch {
  report.error =
    "Live check stopped. See failing check above; secret response data was not printed.";
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (probeId && cookie && csrf) {
    try {
      const r = await request(`/api/uploads/${probeId}`, "DELETE");
      report.cleanupStatus = r.status;
    } catch {
      report.cleanupStatus = "requires verification";
    }
  }
  if (cookie && csrf) {
    try {
      const r = await request("/api/auth/logout", "POST", {});
      const revoked = await request("/api/dashboard");
      report.checks.push({
        name: "Logout revokes session",
        passed: r.status === 200 && revoked.status === 401,
      });
    } catch {
      report.checks.push({ name: "Logout revokes session", passed: false });
    }
  }
  mkdirSync(".wrangler", { recursive: true });
  writeFileSync(".wrangler/live-smoke.json", JSON.stringify(report, null, 2));
  console.log(
    "Sanitized results saved to .wrangler/live-smoke.json. No Reel was created or published.",
  );
}
