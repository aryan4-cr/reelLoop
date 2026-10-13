# Windows PowerShell setup

## 1. Prerequisites

Install Node.js 24 LTS and Git for Windows. Open PowerShell in this folder. Check:

```powershell
node --version
npm --version
git --version
```

If PowerShell blocks npm.ps1, use `npm.cmd` and `npx.cmd` instead of changing your execution policy. Use a local folder outside OneDrive if sync causes file locking; never put your secrets in a shared/synced location without appropriate account protection.

## 2. Install and configure local owner access

```powershell
npm ci
Copy-Item -LiteralPath .env.example -Destination .dev.vars
node scripts/password.mjs
```

Enter a strong password of at least 14 characters. Input is hidden. Copy the resulting PBKDF2 hash into OWNER_PASSWORD_HASH in .dev.vars. The password itself is never saved. Keep single quotes around the hash if you assign it as a PowerShell string, because dollar signs have special meaning inside double quotes. In .dev.vars, the hash can be the plain value after `=`.

Set APP_ORIGIN to `http://127.0.0.1:5173` and PUBLIC_ORIGIN to `http://127.0.0.1:8787` for local UI work. Do not use localhost in one place and 127.0.0.1 in another. Browser cookies and Origin validation rely on consistent hostnames. Never copy development origin values into a public deployment.

Generate TOKEN_ENCRYPTION_KEY (32 random bytes, base64) and a separate MEDIA_SIGNING_KEY (at least 32 random characters) using your password manager, or this local Node command. It writes the keys directly into your ignored local file and prints no key values:

```powershell
node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; import {randomBytes} from "node:crypto"; const path=".dev.vars"; let text=readFileSync(path,"utf8"); if(/^TOKEN_ENCRYPTION_KEY=$/m.test(text)) text=text.replace(/^TOKEN_ENCRYPTION_KEY=$/m,"TOKEN_ENCRYPTION_KEY="+randomBytes(32).toString("base64")); if(/^MEDIA_SIGNING_KEY=$/m.test(text)) text=text.replace(/^MEDIA_SIGNING_KEY=$/m,"MEDIA_SIGNING_KEY="+randomBytes(32).toString("hex")); writeFileSync(path,text);'
```

Do not overwrite an existing encryption key: stored tokens would become unreadable. .env.example is a reference; Wrangler reads .dev.vars locally. No secret belongs in a VITE_ variable or frontend code.

## 3. Initialize the local database and start the app

```powershell
npm run db:local
npm run build
npm run dev:worker
```

Keep that terminal open. In a second PowerShell terminal in the same directory:

```powershell
npm run dev
```

Open `http://127.0.0.1:5173` and sign in with your owner password. The dashboard reports the real local empty database; it never fabricates a connected Instagram account or successful publications. You can edit schedule preferences immediately. Uploading requires real R2 S3 credentials and CORS; local R2 emulation does not expose a public S3 endpoint.

For end-to-end uploads during development, after approving cloud resource use, add `"remote": true` to the VIDEOS R2 binding so Wrangler uses the actual bucket both for S3 staging and bound verification. D1 may stay local. Without this, direct S3 uploads land in cloud R2 while the local binding looks in emulated R2 and verification correctly fails. For a live Meta test use the approved deployed Worker; loopback media URLs are unreachable by Instagram.

## 4. Verify code

```powershell
npm run check
npx wrangler deploy --dry-run --outdir .wrangler/dry-run
```

Tests inject only a mocked Meta adapter; D1 and R2 run in local Cloudflare emulation. The pinned Miniflare package currently carries a beta version and is the same patched generation Wrangler uses; its exported v4 configuration converter is used for the fixture. Use npm ci to retain the tested version set.

## 5. Next steps

Read META_SETUP.md and DEPLOYMENT.md. Stop before cloud resource creation, live deployment, or real publication unless the owner has explicitly approved those actions. You do not need an OpenAI key.

## Troubleshooting

- **Login says setup is required:** fill OWNER_PASSWORD_HASH in .dev.vars and restart Wrangler.
- **403 Origin/CSRF:** sign out/in, use the exact APP_ORIGIN, and refresh. Avoid mixing ports or hostnames.
- **Missing D1 table:** run npm run db:local; production migrations use a separate database.
- **Upload CORS/ETag:** set the exact origin in docs/r2-cors.json, allow PUT and Content-Type/x-amz-* headers, and expose ETag.
- **Upload size or format rejected:** use MP4/MOV, 3–900 seconds, up to 1920 pixels wide and 1 GB. Convert codecs locally. Unknown metadata or MOV decoding can fail in browsers.
- **File locking/EPERM:** close processes using the same build output or move the checkout outside OneDrive.
- **Port already in use:** stop the other local process or consistently change Vite proxy, APP_ORIGIN and Wrangler port.
- **No cron in local dev:** Wrangler's development server does not run production triggers on a timer; `--test-scheduled` exposes a local trigger endpoint. Run `Invoke-WebRequest 'http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*'` only against your development server with publishing disabled, or use the automated suite. A manual test job is real if configured with live credentials.
