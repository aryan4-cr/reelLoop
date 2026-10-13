# Security model and operations

## Owner access

Single owner password, PBKDF2-SHA256 with at least 100,000 iterations and a random salt. Browser login is limited per IP and globally using atomic D1 counters. Sessions contain 256-bit random tokens; only SHA256 digests are stored. Session cookies are HttpOnly, SameSite=Lax, Secure in HTTPS, path=/, and expire after 12 hours. Production HTTP origins are rejected. No sign-up or password reset emails exist.

Every /api administrative endpoint requires a valid server-side session. Mutations require the exact APP_ORIGIN and the session-specific CSRF token. Login checks Origin. OAuth callback instead validates a one-use hashed state bound to the owner session. Body size is capped at 32 KiB, including requests without Content-Length. Mutations are rate-limited and schemas validate settings, names, captions, hashtags and upload metadata.

React escapes user text. The Worker sends CSP, frame denial, no-sniff, no-referrer and HTTPS HSTS headers. No externally loaded font/script or third-party analytics is required. API and media responses are not publicly cached. The private dashboard shell is a public static asset; private data and video bytes require API authentication or a specific signed media capability.

## Secrets and token storage

Use Wrangler secrets in cloud and ignored .dev.vars locally. No secrets belong in Git, VITE_ values, URLs shown in UI, or logs. Meta access tokens use AES-256-GCM with random IV and authenticated context; the encryption key is separate from media HMAC key. Preserve the key or reconnect after deleting encrypted account records. Passwords and tokens are never printed by the application. Provider errors are reduced to safe codes/categories; raw error payloads can contain secrets and are not logged.

Observability defaults off. If enabling request logging, first ensure OAuth code and media signature query parameters are redacted. Platform account administrators can access D1 and secrets; this app does not protect against a compromised Cloudflare owner account. Enable account MFA and least-privilege access.

## R2 restrictions

The bucket remains private. Signatures grant short-lived PUT access only to staging keys or specific multipart parts. Credentials are never exposed. Objects are checked for actual size and recognizable MP4/MOV signature, then copied server-to-server to an immutable final key. The final key is never the target of browser upload credentials. A presigned staging URL can be reused until expiry; overwriting it cannot alter a ready final object. Configure staging and incomplete-multipart lifecycle cleanup as in DEPLOYMENT.md.

The direct S3 service cannot enforce every application policy: a trusted owner holding a signed URL can upload arbitrary bytes to that staging key. Application reservations and verification are bounds for normal use, not an R2 billing firewall. Incorrect or oversized objects are rejected and cleaned up; enforce account budgets/alerts separately if needed. Do not allow arbitrary user registration with this credential/validation design.

Meta's media URLs use HMAC-SHA256 over job ID and expiry, tied to the stored job. URLs authorize a single job's original for up to 24 hours and support GET, HEAD and single byte ranges. Anyone who obtains a valid URL can fetch that one object until it expires. Failed/skipped jobs revoke their endpoint access. Deleting a video also revokes access. Never put the whole library on a public bucket or expose these URLs in dashboard responses.

## Duplicate prevention and limitations

D1's atomic lease, lease-token fencing, transaction batches, and unique active-job index serialize account work. Scheduled and manual jobs use the same database guard. The publish intent is persisted before the single POST; if interrupted it is treated as uncertain, the scheduler pauses, and no automatic replay occurs. A successful response with an actual media ID marks success. Reconciliation requires explicit owner confirmation and verifies that the media ID belongs to the connected account's recent posts and has not already been recorded.

This is a conservative at-most-one-submit policy per persisted job, not a claim of exactly-once delivery across independent Meta and Cloudflare systems. Owner assertions, account changes outside the app, database restoration, or a compromised provider can require manual reconciliation. Do not clear uncertain jobs or restore old publish intents without comparing the Instagram profile first.

Caption/order changes affect future selection. Active jobs keep their original caption/video snapshot; disabling a video does not cancel a job already created. Pausing stops new scheduled publish intents, but cannot withdraw a POST already sent. A separately confirmed manual job runs while general automation is paused. Cancel that individual job if it has not submitted a publish intent.

## Owner credential recovery/rotation

1. Pause automation. Resolve every uncertain/publishing job on the Instagram profile.
2. Generate a new owner password hash locally and set OWNER_PASSWORD_HASH through Wrangler's interactive secret command.
3. Revoke all existing sessions with an approved D1 operation: `DELETE FROM sessions; DELETE FROM oauth_states;`. Password rotation alone does not invalidate existing session tokens.
4. If rotating TOKEN_ENCRYPTION_KEY, disconnect first after resolving active jobs, rotate the key, and reconnect. Existing ciphertext cannot be decrypted with a different key.
5. Rotate MEDIA_SIGNING_KEY only after confirming no active Meta fetch needs the old URL; rotation immediately invalidates previous media links.
6. Rotate R2 keys through Cloudflare and update Worker secrets. Never display the old or new credential values in support requests.

For revoked Instagram permissions: pause, cancel a job whose publish intent was never sent, or reconcile a possibly published job. Then reconnect with the minimal permissions. Reconnection cannot switch accounts while an active job exists.

## Full data deletion

Disconnecting deletes the app's stored token and pauses scheduling; it does not remove R2 originals or history. To remove all app-held data, first pause and resolve active jobs, disconnect, delete every video through the dashboard, then after explicit owner authorization erase D1 history/events/sessions and remove remaining staging uploads from R2. Revoke the app in Instagram's connected apps controls. Publication removal on Instagram itself is a separate owner action; ReelLoop does not delete posted Reels.

## Disclosure

Report bugs with reproduction steps and safe job/provider codes, never tokens, passwords, signed URLs, or private account dumps. Live authentication, R2 IAM/CORS, free-tier CPU fit, and publication remain deployment acceptance checks. Local tests do not substitute for those checks.
