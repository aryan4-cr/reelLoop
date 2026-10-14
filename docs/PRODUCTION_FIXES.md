# OAuth and upload incident — 14 October 2026

Status: fixes prepared locally; production deployment requires new owner approval. Target remains `my-worker` at https://my-worker.reelloop.workers.dev, using the existing D1 database and private R2 bucket. No production mutations or publication were performed during diagnosis.

## Reproduced failures

| Flow                         | Exact reproduced stage                                 | Evidence                                                                                                                                                                               | Fix                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram callback           | First authorization-code exchange, before outbound I/O | Original adapter stored native `fetch` on the instance and invoked `this.fetcher`. Local workerd returned `TypeError: Illegal invocation`; intercepted outbound count was zero.        | Default fetcher is an arrow wrapper that calls native fetch with the correct receiver.                                                                                                  |
| Video upload                 | Staging-to-permanent S3 CopyObject response parsing    | Browser-target AWS bundle received a successful intercepted XML copy response, then threw `ReferenceError: DOMParser is not defined`; outbound count was one.                          | Wrangler aliases the pinned XML builder dependency to its DOM-free CommonJS implementation.                                                                                             |
| Failed finalization recovery | Browser error cleanup                                  | Client previously deleted the pending upload after any completion error, including a server error after bytes were uploaded/copied. The staging-only smoke test bypassed finalization. | Retain pending uploads after completion failures; show Retry finalization in the library. Reuse multipart part metadata in the same tab; completed staging is recoverable after reload. |

The two defects were reproduced using the actual integration code in Cloudflare's local runtime, without real credentials, Meta calls or production media. Existing tests injected a copy callback and ran the adapter in Node; they did not exercise browser-target SDK XML parsing or the native Worker fetch receiver. The new runtime suite covers both gaps.

Historical production exceptions were not retained because observability is disabled to avoid recording sensitive callback/signed URL query strings. The screenshot alone cannot establish the historical provider status or exclude another simultaneous fault. The code defects are deterministic and consistent with the symptoms; successful live OAuth and finalization still require post-deployment verification.

## OAuth stages and configuration

- Owner session and single-use, session-bound state validation remain enforced. Consumed/expired state requires a fresh Connect Instagram flow; never replay the photographed authorization code.
- Authorization and token exchange both use the exact same callback: `https://my-worker.reelloop.workers.dev/api/instagram/callback`.
- Instagram App ID and Secret names are present in the existing Worker. Their values were neither retrieved nor changed. Correctness against Meta cannot be inferred merely from presence.
- Errors now distinguish session, state, code exchange, long-lived token exchange, profile validation, encryption and D1 persistence. Where a provider response exists, only numeric HTTP status and numeric provider error code are reported. Raw messages, URLs, bodies, tokens, authorization codes, cookies and exception stacks are excluded from diagnostics.
- Short/long tokens and positive finite expiry are checked before profile lookup. Tokens are encrypted before a lease-fenced D1 transaction saves the account and pauses publishing. Failed persistence rolls back; no fake connection success is returned.
- Keep the current `v25.0` and minimal `instagram_business_basic,instagram_business_content_publish` scopes. Meta's official developer page returned HTTP 429 during this investigation, so no claim is made that this is the newest API version. No version/credential changes are needed to fix the reproduced runtime defects.

## Upload state and limits

Multipart completion, staging size/header validation, server-side promotion, permanent-object verification and D1 finalization have separate safe error stages. Finalization remains idempotent after `ready`; failed copy/verification/database writes preserve the reservation and staging object. If the lease expires during promotion, D1 does not mark the video ready. A staging deletion failure after the ready commit no longer turns a successfully stored video into an upload failure; the existing lifecycle can remove that staging copy.

Retry finalization within 24 hours. The existing application cleanup considers older pending uploads stale (currently inactive because cron is disabled); the existing R2 lifecycle expires staging after two days. If multipart completion itself failed, the same open tab retains part ETags for retry. If that tab is lost before multipart completion succeeds, discard the incomplete upload and upload again; completed staging can be retried after reload. This patch does not add resumable byte transfer across reloads.

The multipart ETag validation ceiling is widened from 128 to 256 characters to accept the local runtime's opaque 171-character ETags. The existing 32 KiB request-body limit remains in place. This local compatibility finding is not claimed as the cause of the owner's production failure.

Video bytes still upload directly to private R2. The Worker reads only 32 header bytes and invokes server-side copy; it does not buffer an entire MP4. The 8,000,000,000-byte reservation cap is unchanged. Temporary copies, abandoned objects, operation counts and other account usage can consume allowances beyond that cap; it is not an R2 billing ceiling. No additional paid service or plan change is introduced. Real finalization CPU usage on Workers Free cannot be proven by local emulation.

## Verification and rollout

- Full check: TypeScript, 71 tests, production build. Regression tests assert encrypted account persistence, provider-stage failures and sanitization, transactional rollback, object preservation, frontend retention, stale-lease rejection and successful single/multipart finalization. Largest local multipart fixture is 33 MiB; this is not a 1 GB load test.
- Wrangler dry-run passed: 1503.92 KiB Worker, gzip 273.38 KiB, original bindings and empty cron. All 12 runtime cases also passed against this exact packaged output. Repeat using PowerShell: `$env:REELLOOP_WORKER_BUNDLE='.wrangler/fixes-dry-run/index.js'; npx vitest run tests/worker-runtime.test.ts`. This environment variable is a local artifact path, not a credential.
- Read-only production checks: paused, no scheduled time, zero accounts/videos/jobs, original secret names and bindings, no cron schedules, private R2 with correct CORS. Bucket metadata reports zero objects/bytes. No production migration is added or reapplied.
- After owner approval: deploy the reviewed commit, repeat HTTPS/authentication checks, start a fresh Instagram connection, and finalize one owner-selected video. Record actual stage/status if it fails. Do not enable cron, start publishing or create a Reel. Stop if the Free plan cannot safely run the operations; no automatic upgrade.

References: [Cloudflare native fetch receiver issue](https://github.com/cloudflare/workerd/issues/6904), [R2 multipart usage](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/), [Meta Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login), [Meta official Instagram collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).
