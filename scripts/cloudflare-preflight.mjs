// Read-only account checks. Credentials stay in memory and are never printed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
let stage = "credential lookup";
const account = "d0b25c7d1d5d01fe584982892e6a4e94";
try {
  // whoami refreshes this login first. Do not run `auth token`: it prints credentials.
  const credentials = readFileSync(
    join(
      process.env.APPDATA,
      "xdg.config",
      ".wrangler",
      "config",
      "default.toml",
    ),
    "utf8",
  );
  const token = credentials.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token || /\s/.test(token)) throw new Error("Invalid credential output");
  for (const path of [
    "workers/subdomain",
    "workers/account-settings",
    "workers/scripts",
    "subscriptions",
    "workers/scripts/my-worker/schedules",
    "workers/scripts/my-worker/settings",
  ]) {
    stage = path;
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await response.json();
    if (!data.success) {
      console.log(
        JSON.stringify({
          path,
          status: response.status,
          errorCodes: data.errors?.map((e) => e.code),
        }),
      );
      continue;
    }
    const result = path.endsWith("/settings")
      ? {
          usage_model: data.result.usage_model,
          observability: data.result.observability,
          bindings: data.result.bindings?.map((x) => ({
            name: x.name,
            type: x.type,
            ...(x.type === "d1" ? { id: x.id } : {}),
            ...(x.type === "r2_bucket" ? { bucket_name: x.bucket_name } : {}),
          })),
        }
      : path === "workers/scripts"
        ? data.result.map((x) => ({ id: x.id }))
        : path === "subscriptions"
          ? data.result.map((x) => ({
              product: x.rate_plan?.public_name,
              currency: x.currency,
              price: x.price,
            }))
          : data.result;
    console.log(JSON.stringify({ path, result }));
  }
} catch {
  console.error(
    `Cloudflare read-only preflight failed at ${stage}; no credentials were displayed.`,
  );
  process.exitCode = 1;
}
