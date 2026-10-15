# Batch Loop — 15 October 2026

The owner requested the entire enabled library every **5 hours**, superseding the original three-hour examples, and approved deployment after the checks passed. Single Reel Loop and Publish Once remain available. Batch Loop defaults to 300 minutes when selected. A batch size of 0 selects all enabled ready videos; a positive size selects the first N in queue order, up to 20 to bound per-invocation work on the existing Free Worker.

## Durable execution

Migration `0003_batch_loop.sql` is additive. It adds `batches`, `batch_items`, a job batch reference and two settings fields. It does not rewrite existing video/job records. Each batch snapshots ordered video IDs, object keys, combined captions/hashtags, covers and frame offsets. Each item reserves a stable job ID; its publishing job is materialized transactionally only when that item becomes active. This retains the existing unique-one-active-job invariant instead of creating concurrent queued jobs. The pending item and job activation commit together. Shared images stay referenced and protected from deletion.

Items use the existing container/processing/ready/publishing/uncertain workflow. Successful items are not retried. Uncertain jobs block progression and require reconciliation. A batch survives Worker restarts. Pause halts automatic progression; cancellation skips only unpublished items and blocks if a publish is uncertain. Editing schedule settings requires pausing and resolving/cancelling the current batch. Existing caption/cover edits affect future batches, not snapshots already created.

Only one batch is active. The next boundary is computed from the batch's original start time after it completes; missed boundaries are skipped. There is no overlapping batch or catch-up burst. One minute is reserved after a successful post before promoting the next item. With normal processing, UI estimates start around +2 minutes and then +3 minutes per item; these are explicitly estimates, not simultaneous or guaranteed publication times. Active-batch previews use remaining snapshots. Processing, quotas and cooldowns can delay them. Cooldowns longer than the requested interval block start; other cooldown delays are shown without silently modifying the configured cooldown.

## Quota and confirmation

Batch start/resume requires the explicit `START BATCH LOOP` confirmation, validates the live Instagram quota and its returned window, and rejects a batch or planned volume beyond that limit. The first batch step rechecks remaining quota, and each creation/publication keeps the existing quota and provider-error checks. The dashboard shows estimated volume and repeated-content/spam risks. Four videos every five hours average 19.2 Reels/day, up to 20 in a 24-hour window; actual limits are never hardcoded to this estimate.

Read-only live checks returned HTTP 200: quota usage **0**, total **100**, window **86,400 seconds**. The five recent Instagram Reels were dated 10 October, while ReelLoop had no successful job. Three manual jobs were skipped; the latest had a container but no published media ID. This is not proof of a successful ReelLoop post. Tokens, encrypted credentials and signed URLs were never printed. Meta's [quota reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/) returned HTTP 429 during documentation retrieval; the successful account-specific API response is the live quota evidence.

## Verification and release

93 tests passed, including four-item batches, configurable three/five-hour spacing, library repetition, pause/resume from durable state, processing delay, quota exhaustion, failure continuation, concurrency, uncertain outcomes, cancellation, immutable captions/shared covers, migration compatibility and grouped forecasts. TypeScript, production build and Wrangler dry-run passed. All 13 runtime cases also passed against the exact packaged Worker (1532.62 KiB, gzip 278.95 KiB). The isolated local dashboard showed four items in each of three five-hour batches, disabled Start until confirmation, and no browser warnings/errors. No production posting occurred during these tests.

Production was paused before development; all four ready videos and previous history remain. The owner subsequently approved deployment and one real test after deployment. Deployment and that single test are recorded below when performed. Batch automation must remain paused until the owner explicitly starts it in Scheduling.

Rollback: first pause and resolve/cancel any active batch; leave additive tables intact. Revert the Worker to `a08f6519-86ba-497d-b1a3-ecf9ad5b24fe` only with no active batch/job, and keep publishing paused. Older code cannot process pending batch items. Never restore an older database snapshot over new results. No new resources, dependencies or paid services are introduced.

## Deployment result

Migration 0003 and commit `de255ec` deployed successfully as Worker version `15793199-79c4-4bbb-a4b1-db5bb8bc7ddd`. Cron remains registered every minute. Production D1 confirms enabled=0, interval=300, batch_enabled=1, batch_size=0, cooldown=0 and four ready videos. Existing secrets, records and R2 objects were preserved. HTTPS/current assets return 200; anonymous dashboard and quota endpoints return 401. A single owner-authorized real-post test is pending the interactive owner login; no Batch Loop start was requested or performed.
