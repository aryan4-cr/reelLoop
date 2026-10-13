# Meta Instagram Login setup

ReelLoop uses **Instagram API with Instagram Login** for one professional Creator account. It does not ask for an Instagram password or use cookies/private endpoints. It does not require a linked Facebook Page for this login path. Do not mix Facebook Login scopes, Page access tokens, or the retired Basic Display API with this integration.

## 1. Create/configure your Meta app

1. Sign in to [Meta for Developers](https://developers.facebook.com/apps/) as the account owner and create an app/use case that supports Instagram API with Instagram Login. Dashboard labels and available use cases can vary; follow the live official onboarding rather than a legacy app-type tutorial.
2. Add the Instagram product and its Instagram Login configuration. Use the **Instagram app ID and secret** shown for this product; do not accidentally use an unrelated Facebook application ID.
3. Ensure the target Instagram profile is a professional **Creator** account. Personal accounts cannot publish through this API.
4. Configure the exact valid OAuth redirect URI: `https://YOUR-WORKER.workers.dev/api/instagram/callback`. The URI used during code exchange must be identical.
5. Configure applicable app-domain, privacy policy and data-deletion requirements shown in the Meta dashboard. Deletion means disconnecting and erasing your app-held tokens/data; see SECURITY.md for a complete owner-admin procedure. Public policy pages and App Review submissions are owner responsibilities; no policy URL or approval has been invented.
6. Set META_APP_ID and META_APP_SECRET using Wrangler secrets. Set APP_ORIGIN/PUBLIC_ORIGIN to your approved HTTPS Worker origin and confirm META_API_VERSION is supported by the app. v25.0 is the configurable baseline, not a claim about the latest version.

## 2. Permissions and development mode

The requested scopes are only:

- `instagram_business_basic`: account/profile access.
- `instagram_business_content_publish`: media container creation and publishing.

Use the current business-prefixed Instagram Login scopes. Do not replace these with Facebook Login's `instagram_basic`, `instagram_content_publish` or pages_* permissions. Comments, messaging, insights, and ads permissions are not requested.

In development mode, access is limited to authorized app roles/test accounts under Meta's current rules. Add the owner as an allowed Instagram tester/role in the product's dashboard, then accept any pending tester invitation in the Instagram account settings. Verify that the tester can authorize the app before expecting content publishing.

For accounts outside your app roles, Meta generally requires the applicable permission's advanced access and App Review; business verification or additional onboarding may apply to your app/use case. A private personal deployment does not grant blanket exemption. Consult the app dashboard's current requirements. **No App Review, business verification or live-mode approval has been completed here.**

## 3. Connect through the dashboard

1. Deploy the configured Worker only after owner approval. Sign into ReelLoop.
2. Choose Connect Instagram. ReelLoop generates a random state, stores only its hash bound to the owner session, and redirects to `https://www.instagram.com/oauth/authorize`.
3. Authorize the professional account through Instagram. The one-use state expires after ten minutes; the owner session must still exist on callback.
4. ReelLoop exchanges the authorization code at `https://api.instagram.com/oauth/access_token`, then exchanges the short-lived token at `https://graph.instagram.com/access_token` with `ig_exchange_token`.
5. It discovers the authorized account via `graph.instagram.com/{version}/me`, encrypts the long-lived token with AES-GCM, and stores expiration metadata. Your token is never returned to the browser or logged.
6. The account card shows the real username and expiry. Connecting/reconnecting pauses automation. Resolve active jobs before changing the account or credentials.

Long-lived tokens commonly expire in roughly 60 days; code uses Meta's actual expires_in response. Near expiry, a running scheduler refreshes via `graph.instagram.com/refresh_access_token` with `ig_refresh_token`, only after the token is old enough. Revoked/expired tokens require owner reauthorization. Long periods with automation paused can require reconnecting; no password-based fallback exists.

## 4. Video and rate-limit requirements

The maintained Meta API collection describes MP4/MOV, H.264 or HEVC video, AAC audio, 23–60 FPS, maximum horizontal resolution 1920, 3–900 seconds, maximum 1 GB, and bitrate constraints. Recommended aspect ratio is 9:16. Verify the current authoritative specifications before production use.

ReelLoop performs browser metadata checks plus server object-size and MP4/MOV box-signature verification. It cannot inspect every track/codec or transcode in a Worker. Meta rejects incompatible media during processing; errors remain in history. If needed, install FFmpeg locally and convert before uploading (example conversion, review quality yourself):

```powershell
ffmpeg -i input.mov -vf 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2' -c:v libx264 -pix_fmt yuv420p -r 30 -b:v 8M -maxrate 20M -bufsize 20M -c:a aac -ar 48000 -b:a 128k -movflags +faststart output.mp4
```

Do not use looping content to evade Instagram's spam/content policies. The default per-video repeat cooldown is 24 hours. Verify rights to every upload and caption. Provider publishing quotas are fetched via `/{account-id}/content_publishing_limit`; ReelLoop does not assume a universal fixed daily quota. Provider rate-limit errors delay pre-publish attempts using Retry-After/backoff.

Media publishing uses the Instagram host:

- `POST /{version}/{account-id}/media`, media_type=REELS, HTTPS video_url, caption.
- `GET /{version}/{container-id}?fields=status_code`, polled on later cron ticks.
- `POST /{version}/{account-id}/media_publish`, only after FINISHED.

A returned container ID is not a post. A returned published media ID is the confirmation used for success. A lost publish response is uncertain and requires owner reconciliation; it is never blindly replayed.

## 5. Live verification

Do not publish until the owner explicitly authorizes one specific test. Follow [docs/LIVE_TEST.md](docs/LIVE_TEST.md). Record the returned media ID and verify the actual Reel on the authorized profile. Until then, live OAuth, publishing permissions, provider processing and publication remain unverified.

## Official sources and retrieval limitation

- [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/)
- [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/)
- [Content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/)
- [Meta's official Postman API collection](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api)

Meta's developer pages returned access/rate-limit errors during this implementation. The maintained Meta collection was accessible and corroborated the container/status/publish process and media specifications; its Facebook Login examples must not be copied as Instagram Login authentication. Check the direct official Login documentation and the live app dashboard for the app-specific version, scopes, and review requirements before live testing.
