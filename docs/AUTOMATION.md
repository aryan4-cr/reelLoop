# Cloud automation — 15 October 2026

The owner authorized the existing Worker cron to run every minute, with automatic publishing remaining paused until started from the dashboard. This configuration uses the existing D1 schedule and private R2 storage; the laptop is not involved in scheduled execution.

Preflight confirmed Instagram connected with a non-expired token, one ready enabled video, and two manual jobs in skipped state after the owner cancelled the latest queued test through the dashboard. No creating, processing, ready, publishing or uncertain job remained. Existing videos, covers, credentials and history were preserved.

Production settings: interval 180 minutes, mode loop, repeat cooldown 0, enabled 0. The prior 24-hour cooldown was removed so a small library can repeat on the three-hour schedule. Start/resume persists the selected first time in D1. Processing delays, provider limits, cooldown choices and missed slots can delay publication; exact wall-clock delivery is not guaranteed.

Use Scheduling → Start / resume (optionally choose a start time), or Overview → Start automation. Use Pause to stop automatic progression; an already submitted request can finish. A separately confirmed manual test can run even while automation is paused. Avoid queuing a manual test unless you intend to publish it.

Existing tests cover persisted start/pause/resume, continuous queue wrap, nominal three-hour slots, cooldowns, concurrency fencing, single active jobs, immutable caption/cover snapshots, retry delays and uncertain outcomes. A publishing intent is recorded before submitting; interrupted/uncertain publication requires owner reconciliation and is never blindly retried. The cron also reactivates existing hourly housekeeping of expired sessions and stale incomplete uploads; verified originals and referenced covers are retained.

No real Instagram publication was performed for this task. Live end-to-end publishing and Meta cover acceptance remain unverified. No service or plan upgrade was introduced; account-wide usage and existing R2 operation/storage allowances still apply.

Release verification: deployed Worker version `a08f6519-86ba-497d-b1a3-ecf9ad5b24fe`. Cloudflare schedules API confirms `* * * * *`. Post-deploy D1 confirms enabled=0, interval=180, loop mode, cooldown=0, two skipped manual jobs and one ready video. HTTPS returns 200 with HSTS; anonymous dashboard API returns 401. All 83 tests, TypeScript, production build and Wrangler dry-run passed. Start/pause/resume were tested locally with persisted D1 state, not activated against production. Cron registration is verified; a real publishing cycle has not been exercised.
