# ReelLoop

A private dashboard for one Instagram professional Creator account. React + TypeScript + Vite + Tailwind, Hono on Cloudflare Workers, private R2 Standard storage, D1, and a one-minute Cron Trigger. No AI service runs in production.

## Current verification status

Implemented locally: secure owner sessions; five responsive dashboard sections with dark/light themes; direct signed R2 upload and multipart orchestration; metadata editing and ordering; official Instagram Login adapter; persistent repeating scheduler; history, retries, and uncertain-outcome reconciliation. Automated tests use Cloudflare's local D1/R2 runtime and mocked Meta calls, never a simulated production publisher.

**Not deployed. Live R2 uploads, Meta authorization, and actual Instagram publishing remain unverified and blocked on owner configuration and explicit approval.** A successful container creation is not counted as a successful publication. Do not treat a passing mock test as evidence of live publication.

Start with [SETUP.md](SETUP.md), then [META_SETUP.md](META_SETUP.md) and [DEPLOYMENT.md](DEPLOYMENT.md). Security and recovery: [SECURITY.md](SECURITY.md). Controlled acceptance testing: [docs/LIVE_TEST.md](docs/LIVE_TEST.md).

## Local commands

```powershell
npm ci
Copy-Item .env.example .dev.vars
node scripts/password.mjs
# Put the generated hash in OWNER_PASSWORD_HASH in .dev.vars.
npm run db:local
npm run build
# Terminal 1:
npm run dev:worker
# Terminal 2:
npm run dev
# Visit http://127.0.0.1:5173
```

`npm run check` runs TypeScript, automated tests, and the frontend build. `npx wrangler deploy --dry-run --outdir .wrangler/dry-run` validates Worker packaging without deployment. `npm run deploy` is a real external action and must be run only after owner approval.

## How publishing works

1. An owner confirms a test or starts the paused schedule. Verified, enabled videos are eligible; captions are copied into immutable job snapshots.
2. Cron wakes every minute. An atomic D1 lease and a unique active-job index serialize operations for the account.
3. The scheduler checks the provider quota, gives Meta a signed job-specific media URL, creates a Reel container, and saves its ID.
4. Later ticks poll at least 60 seconds apart. Only `FINISHED` permits publishing. Processing is bounded to one hour.
5. Before the publish POST, the job enters persistent `publishing` state. If the result is lost, the scheduler never blindly sends the POST again: it marks the outcome uncertain, pauses, and requires profile verification.
6. Only a returned Instagram media ID, or an owner-reconciled ID verified against the account's recent posts, marks success. D1 updates the video, job and queue cursor in a transaction. The R2 original is retained.
7. The next slot uses the configured elapsed interval (default three hours). Missed slots are skipped, preventing catch-up bursts. Cooldown can postpone repeats; default is 24 hours per video. Publish-once skips every video with a previous success, including manual tests.

Changing order uses the current location of the last published video, with a stored position fallback if it was deleted. Adding/removing videos does not destroy active jobs; active videos cannot be deleted until their job is cancelled or reconciled. Pausing prevents new scheduled publish intents; a request already sent to Meta can still finish. A specifically authorized manual test continues while general automation is paused. Cancellation is the control for that individual job.

## Boundaries

- 500 video reservations; 1 GB per file; 10 GiB default application quota. R2's pricing uses different storage units; verify current pricing before uploading a large library. Incomplete reservations count against the quota and expire after 24 hours.
- Browser duration/dimension checks are advisory metadata. The Worker checks object size and container signature, not complete codec correctness. Meta is the final codec/format validator; convert locally if needed. No transcoding runs in Workers.
- Bulk uploads run sequentially and multipart parts retry up to three times. Interrupted uploads can be discarded; cross-browser-session multipart resume is not implemented.
- History retains all jobs in D1; the UI loads the latest 100. Reconciliation checks the latest 100 Instagram media items; older ambiguous jobs require manual investigation rather than guessing.
- A minute trigger provides minute-level job dispatch, not guaranteed second-accurate publication. Container processing adds delay. Cron changes can take time to propagate.
- Owner password authentication is single-owner, no public sign-up or reset email. Recovery requires access to Cloudflare secrets. Rotate/revoke sessions as described in SECURITY.md.
- Tokens refresh near expiry when the engine runs; reconnect after a long pause if authorization expires. You may need Meta App Review for accounts outside app roles.

## Source map

- `src/`: dashboard, accessible modal controls, direct upload client.
- `worker/index.ts`: authenticated API and private media serving.
- `worker/scheduler.ts`: persistent single-account state machine.
- `worker/instagram.ts`: real Meta HTTP adapter; no production mock mode.
- `worker/storage.ts`: R2 signed uploads, immutable promotion, verification, ranges, cleanup.
- `worker/security.ts`, `worker/lease.ts`: sessions, cryptography, rate limits, fencing.
- `migrations/`: deployable D1 schema. `tests/`: queue, API, storage, scheduler and adapter coverage.

## Official references

Implementation consulted Cloudflare's [R2 presigned URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [R2 multipart API](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/), [D1 transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), and [Meta's maintained API collection](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api). Meta's primary documentation requests were blocked/rate-limited during implementation; verify the configured API version, Login settings and current permissions against the live dashboard before authorization. See META_SETUP.md for direct official links.
