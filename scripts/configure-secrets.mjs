// Run in an interactive terminal only AFTER approving creation/deployment of my-worker.
// Secret values are never command arguments or console output.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const cli = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const names = [
  "OWNER_PASSWORD_HASH",
  "TOKEN_ENCRYPTION_KEY",
  "MEDIA_SIGNING_KEY",
  "R2_ACCOUNT_ID",
  "META_APP_ID",
  "META_APP_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];
const env = {
  ...process.env,
  CLOUDFLARE_ACCOUNT_ID: "d0b25c7d1d5d01fe584982892e6a4e94",
  WRANGLER_LOG: "log",
  WRANGLER_LOG_SANITIZE: "true",
  WRANGLER_LOG_PATH: ".wrangler/logs",
};
if (!process.stdin.isTTY || !process.argv.includes("--approved")) {
  console.error(
    "After owner deployment approval, run in a terminal: node scripts/configure-secrets.mjs --approved",
  );
  process.exit(1);
}
// Keep values in Wrangler's masked prompt. Never use --debug or shell transcripts.
let localText = readFileSync(".dev.vars", "utf8");
const local = parseEnv(localText);
const listing = spawnSync(
  process.execPath,
  [cli, "secret", "list", "--name", "my-worker"],
  { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
let existing = new Set();
if (listing.status === 0) {
  try {
    existing = new Set(JSON.parse(listing.stdout).map((x) => x.name));
  } catch {
    console.error("Could not safely read installed secret names; stopped.");
    process.exit(1);
  }
} else if (
  !/(?:10007|Worker "my-worker" not found\.)/.test(
    listing.stderr + listing.stdout,
  )
) {
  console.error(
    "Could not verify target Worker secrets; stopped without changes.",
  );
  process.exit(1);
}

for (const name of names) {
  if (existing.has(name)) {
    console.log(`${name}: already installed; preserved.`);
    continue;
  }
  if (
    !local[name] &&
    ["TOKEN_ENCRYPTION_KEY", "MEDIA_SIGNING_KEY", "R2_ACCOUNT_ID"].includes(
      name,
    )
  ) {
    local[name] =
      name === "R2_ACCOUNT_ID"
        ? "d0b25c7d1d5d01fe584982892e6a4e94"
        : randomBytes(32).toString(
            name === "TOKEN_ENCRYPTION_KEY" ? "base64" : "hex",
          );
    // Retain generated keys in the existing ignored local secrets file for recovery.
    const line = `${name}=${local[name]}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    localText = pattern.test(localText)
      ? localText.replace(pattern, () => line)
      : `${localText}\n${line}\n`;
    writeFileSync(".dev.vars", localText);
  }
  if (local[name]) {
    if (
      (name === "TOKEN_ENCRYPTION_KEY" &&
        Buffer.from(local[name], "base64").length !== 32) ||
      (name === "MEDIA_SIGNING_KEY" && local[name].length < 32) ||
      (name === "OWNER_PASSWORD_HASH" &&
        !/^pbkdf2\$(?:100000|[1-9]\d{5}|1000000)\$[^$]+\$[a-f0-9]{64}$/i.test(
          local[name],
        )) ||
      (name === "R2_ACCOUNT_ID" &&
        local[name] !== "d0b25c7d1d5d01fe584982892e6a4e94")
    ) {
      console.error(
        `${name}: local value is invalid for this target; stopped without displaying it.`,
      );
      process.exit(1);
    }
  }
  console.log(
    `${name}: ${local[name] ? "installing saved local value" : "enter value into Wrangler's masked prompt"}.`,
  );
  const result = spawnSync(
    process.execPath,
    [cli, "secret", "put", name, "--name", "my-worker"],
    {
      env,
      stdio: local[name] ? ["pipe", "inherit", "inherit"] : "inherit",
      ...(local[name] ? { input: local[name] + "\n" } : {}),
    },
  );
  if (result.status !== 0) {
    console.error(`${name}: upload did not complete; stopped.`);
    process.exit(1);
  }
}
console.log(
  "All required secret commands completed. Publishing remains paused. Return to the deployment chat for verification.",
);
