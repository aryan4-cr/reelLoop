# Cloudflare deployment

**No cloud resources or production deployments were performed during implementation. Obtain owner approval before executing the external steps below.** The application does not require a paid custom domain; a HTTPS workers.dev hostname serves the dashboard, API, OAuth callback, and signed media endpoint together.

## 1. Cloudflare resources (external actions)

Enable R2 Standard in your Cloudflare account. Billing activation may be required even within the included usage. Review current pricing first; do not adopt a paid plan without approval.

```powershell
npx wrangler login
npx wrangler d1 create reelloop
npx wrangler r2 bucket create reelloop-videos
```

Replace the placeholder database_id in wrangler.jsonc with the actual returned ID. Confirm the account and resource names. Do not set R2 public access or expose the entire bucket.

Create an R2 API token scoped to object read/write in only this bucket. Save the generated account ID, access key ID and secret access key as Worker secrets. These S3 credentials stay server-side; browsers receive URLs restricted to individual staging objects and parts.

## 2. Domain and variables

Set APP_ORIGIN and PUBLIC_ORIGIN in wrangler.jsonc to the exact deployed origin, e.g. `https://reelloop.YOUR-SUBDOMAIN.workers.dev`. Both should normally match; do not protect /media/* with a browser login wall or Meta cannot fetch the job-specific URL. This path has its own HMAC authorization.

META_API_VERSION defaults to v25.0 as a configurable baseline. Confirm Meta supports that version for your app before deployment; do not assume it is the newest. R2_BUCKET_NAME must match the R2 binding bucket_name. MAX_STORAGE_BYTES is an application reservation limit, default 10 GiB; decrease it if you want more headroom in R2's included storage allowance.

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
npx wrangler d1 migrations apply reelloop --remote
npm run deploy
```

Static assets in dist are packaged with the Worker. /api/* and /media/* execute the Worker before the SPA fallback. D1 state and R2 objects persist through deploys. The one-minute cron uses persisted UTC next_publish_at, not fixed three-hour UTC boundaries. New databases start paused; redeployment preserves an existing enabled schedule, so pause through the dashboard before maintenance if necessary.

Ensure your Meta app's exact callback URL is `https://YOUR-WORKER.workers.dev/api/instagram/callback`. Follow META_SETUP.md before account connection. Connecting/reconnecting pauses the schedule. A workers.dev domain is technically sufficient for HTTPS callbacks/media; Meta app review or domain verification can introduce account-specific requirements. Verify those in Meta rather than purchasing a domain speculatively.

## 6. Post-deployment checks

Verify HTTPS, sign-in, secure cookies, owner-only API responses, and that automation is paused. Upload eight authorized videos, confirm progress, play private previews, edit captions, reorder, refresh, and verify originals remain. This still does not authorize posting. Obtain a distinct owner confirmation before the first real Reel, then follow docs/LIVE_TEST.md.

## Costs and runtime limits

This design avoids Durable Objects and paid queues. Workers, D1 and R2 have included allowances, not unlimited free usage. Cron is ~1,440 invocations per day; dashboard polling and API calls add usage. D1 lookup indexes bound the small single-owner workload. R2 upload, verification, and promotion consume operations; stored originals and temporary copies consume storage.

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
