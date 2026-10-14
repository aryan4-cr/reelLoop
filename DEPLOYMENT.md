# Cloudflare deployment

**Deployed 14 October 2026 with explicit owner approval. All eight secrets are installed. Production login, secure cookies, D1, signed R2 upload/CORS/cleanup and logout passed live checks on the owner-confirmed Workers Free plan. Publishing is paused and cron disabled.** Version: `ea51b7a0-9f61-48e7-b6bc-dc0e847954e5`. See docs/IMPLEMENTATION_STATUS.md for evidence and remaining Meta work.

## Verified production target

- Account: Gamingarj795@gmail.com's Account (`d0b25c7d1d5d01fe584982892e6a4e94`). Wrangler OAuth verified.
- Worker: `my-worker`; no pre-existing Worker was overwritten. Its verified account subdomain is `reelloop`.
- Origin: `https://my-worker.reelloop.workers.dev`; both origin variables already match.
- Existing D1: **reelloop-db**, ID `289411ef-6f89-40b5-bcaf-69e33dfffb78`, binding `DB`. The original config called it reelloop; its actual cloud name is now reflected in configuration.
- Existing R2: `reelloop-videos`, binding `VIDEOS`, APAC, Standard, empty at preflight. r2.dev disabled; no custom domains.
- CORS already matches docs/r2-cors.json exactly; no replacement was necessary.
- Added `reelloop-staging-cleanup`: expire `staging/` after two days and abort its incomplete multipart uploads after one day. Preserved the default seven-day multipart-abort rule. No originals expiration.
- Remote `0001_initial.sql` applied successfully. Verified `enabled=0`, `next_publish_at=NULL`, zero active jobs, Asia/Kolkata and 180-minute interval.
- Initial deployment has **no cron trigger**. Enabling a schedule in the UI alone will not run it until an explicitly approved later deployment restores `* * * * *`. This also defers hourly application cleanup; R2 lifecycle cleanup remains active.
- Reservation cap is now 8,000,000,000 bytes (8 GB), leaving headroom for temporary copies. This is not an account billing cap; orphan/staging objects, other buckets and operation usage also count.

The read-only subscriptions API returned 403 under the current OAuth scopes. `default_usage_model=standard` is not proof of a Free subscription. The owner subsequently confirmed Workers Free ACTIVE and R2 usage-based billing ACTIVE from Billing > Subscriptions. No plan change is authorized.

After owner approval, run `node scripts/configure-secrets.mjs --approved` in an interactive terminal. It invokes Wrangler secret commands, preserves installed secrets, reuses the local owner hash, generates missing encryption/signing keys into the existing ignored .dev.vars file, and supplies the verified account ID. Missing Meta App ID/secret and R2 access key ID/secret are entered directly into Wrangler's masked prompts. Back up the generated keys securely. This command can create the first draft Worker; do not run it before approval. It does not deploy ReelLoop or enable cron.

## 1. Cloudflare resources (external actions)

Enable R2 Standard in your Cloudflare account. Billing activation may be required even within the included usage. Review current pricing first; do not adopt a paid plan without approval.

```powershell
npx wrangler login
npx wrangler d1 create reelloop-db
npx wrangler r2 bucket create reelloop-videos
```

These creation commands are reference material for a fresh account only. **Do not run them for this installation: both resources already exist.** Confirm the account and resource names. Do not set R2 public access or expose the entire bucket.

Create an R2 API token scoped to object read/write in only this bucket. Save the generated account ID, access key ID and secret access key as Worker secrets. These S3 credentials stay server-side; browsers receive URLs restricted to individual staging objects and parts.

## 2. Domain and variables

Set APP_ORIGIN and PUBLIC_ORIGIN in wrangler.jsonc to the exact deployed origin, e.g. `https://reelloop.YOUR-SUBDOMAIN.workers.dev`. Both should normally match; do not protect /media/* with a browser login wall or Meta cannot fetch the job-specific URL. This path has its own HMAC authorization.

META_API_VERSION remains v25.0 as a configurable baseline. The latest supported version could not be verified because Meta's official changelog returned 429; check the app dashboard. R2_BUCKET_NAME matches the R2 binding bucket_name. The deployed configuration sets MAX_STORAGE_BYTES to 8 GB; the code fallback remains 10 GiB.

## 3. Secrets

Set each secret interactively; avoid secret values in command lines/history:

```powershell
npx wrangler secret put OWNER_PASSWORD_HASH
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put MEDIA_SIGNING_KEY
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

Use the OWNER_PASSWORD_HASH from the hidden password script, a 32-byte base64 token encryption key, and a distinct random media-signing secret of at least 32 characters. Store a backup of encryption keys securely. No Instagram password is required.

## 4. CORS and storage lifecycle

Edit docs/r2-cors.json: replace the placeholder with your exact dashboard origin. Add your local origin only if approved development should access cloud R2.

```powershell
npx wrangler r2 bucket cors set reelloop-videos --file docs/r2-cors.json
```

R2 browser uploads need PUT, Content-Type and x-amz-* headers; multipart completion reads ETag. Bucket URLs use the R2 S3 domain, which supports presigned requests. A custom R2 domain is not required.

In the R2 dashboard, add lifecycle rules to abort incomplete multipart uploads after 1 day and delete only objects with the `staging/` prefix after 2 days. Never set a delete lifecycle on `videos/`. This cleans late uploads to old presigned URLs and orphaned staging objects that lack a D1 reservation. The app cleans known stale reservations hourly and retries pending deletions. Staging-to-final promotion temporarily duplicates storage; leave headroom in R2.

## 5. Prepare and deploy (after explicit approval)

```powershell
npm ci
npm run check
npx wrangler deploy --dry-run --outdir .wrangler/dry-run
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

Static assets in dist are packaged with the Worker. Every request executes the Worker first to enforce HTTPS, then static requests use the ASSETS binding. Static page/asset requests therefore count toward Workers request allowances. Preview URLs are disabled. D1 state and R2 objects persist through deploys. When separately approved and restored, the one-minute cron uses persisted UTC next_publish_at, not fixed three-hour UTC boundaries. New databases start paused; redeployment preserves an existing enabled schedule, so pause through the dashboard before maintenance if necessary.

Ensure your Meta app's exact callback URL is `https://YOUR-WORKER.workers.dev/api/instagram/callback`. Follow META_SETUP.md before account connection. Connecting/reconnecting pauses the schedule. A workers.dev domain is technically sufficient for HTTPS callbacks/media; Meta app review or domain verification can introduce account-specific requirements. Verify those in Meta rather than purchasing a domain speculatively.

## 6. Post-deployment checks

Verify HTTPS, sign-in, secure cookies, owner-only API responses, and that automation is paused. Upload eight authorized videos, confirm progress, play private previews, edit captions, reorder, refresh, and verify originals remain. This still does not authorize posting. Obtain a distinct owner confirmation before the first real Reel, then follow docs/LIVE_TEST.md.

## Costs and runtime limits

This design avoids Durable Objects and paid queues. Workers Free includes 100,000 requests/day and 10 ms CPU/invocation; D1 Free includes 5 million rows read/day, 100,000 written/day and 5 GB storage. R2 Standard includes 10 GB-month, 1 million Class A and 10 million Class B operations/month across the account. Excess R2 Standard usage is $0.015/GB-month, $4.50/million Class A and $0.36/million Class B, with billing-unit rounding. R2 egress is free. No zero-cost guarantee is possible from the application reservation cap alone. No paid plan or new paid service was selected.

Cron is disabled for this initial deployment. If later enabled, it adds about 1,440 invocations/day; dashboard polling and API calls add usage. D1 lookup indexes bound the small single-owner workload. R2 upload, verification, and promotion consume operations; stored originals and temporary copies consume storage.

PBKDF2 owner password checks and the AWS S3 signer are heavier than basic requests. Cloudflare Free has a short CPU budget; local dry-runs do not enforce production CPU quotas. Measure login/upload signing on the approved deployed Free Worker. If limits are exceeded, optimize or evaluate Cloudflare Access authentication before deciding whether a paid Workers plan is required. No paid plan has been selected. Do not lower the password work factor to hide quota failures.

Official pricing/limits: [Workers](https://developers.cloudflare.com/workers/platform/limits/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/).

## Recovery and troubleshooting

- Cron settings can take time to propagate. Check the Worker trigger and persisted next_publish_at. Never repeatedly click test-publish to diagnose timing.
- Processing ERROR/EXPIRED: inspect encoding and app permissions; the original remains stored. Failed pre-publish jobs retry with backoff and pause after three failed jobs.
- An interrupted publish becomes uncertain. Open History, inspect Instagram, and reconcile the correct media ID or explicitly confirm no Reel was published before cancelling. Never replay the POST manually.
- Reauthentication required: pause, cancel an unpublished job or reconcile an uncertain one, then reconnect. No account switch is allowed while a job is active.
- R2 access denied: verify account ID, token scope, bucket name, CORS origin, and direct S3/bound bucket consistency.
- Signature expiry: media links last 24 hours. Cancel an old unpublished job and start a new one; never retry a possible publication without profile verification.
- Observability defaults off to avoid recording OAuth codes and signed media URLs. If enabling it, use supported query-string redaction and confirm secrets are absent before retaining logs.
- Database backup/restore: pause first; inspect D1 Time Travel support for your account and preserve the matching R2 objects and token encryption key. Restoring older D1 state can lose publish intents; manually reconcile Instagram before resuming to avoid duplicates.

## Worker compatibility regression checks

Instagram uses an arrow wrapper around native fetch. Calling a stored native fetch as an adapter method binds the wrong receiver in workerd and fails before network I/O. Preserve the wrapper.

The browser-target AWS SDK XML parser requires DOMParser, which Workers does not provide. Wrangler aliases @aws-sdk/xml-builder to its DOM-free CommonJS build. The existing version 3.972.41 is now a direct exact dependency; esbuild 0.28.2 is an exact development dependency for runtime regressions. No transitive dependency upgrade is included. Preserve the alias and rerun the Worker-runtime suite when updating AWS dependencies.

The current OAuth/upload patch is not deployed. It requires no new resources, plans, secrets or D1 migration. See [production fix report](docs/PRODUCTION_FIXES.md). Do not run a production deployment until the owner approves this patch.

After approval, verify Connect Instagram using a fresh authorization flow and test finalization of one owner-selected video while the schedule remains paused. The earlier staging smoke test intentionally does not finalize a video and cannot validate CopyObject or D1 ready-state persistence. Do not enable cron or publish content as part of this check.
