# Controlled live acceptance procedure

No live deployment or publication is authorized by this document alone. Obtain explicit owner approval for deployment and separately for posting one real Reel to the named Instagram account. Keep automation paused throughout initial testing.

## Before any publish

- Verify exact HTTPS origins, D1/R2 bindings, secrets, CORS and private bucket permissions.
- Sign in, confirm anonymous API requests return 401, and confirm a fresh database is paused.
- Upload eight supported videos owned by the account operator. Confirm each completes verification, is previewable, and remains after refresh/redeployment. Rename, edit captions/hashtags, disable/enable, reorder using drag/drop and keyboard arrows, and confirm queue preview updates.
- Connect the actual Creator account through Instagram Login. Record the username and token expiration without copying the token. Validate required permissions in Meta's dashboard.
- Select an innocuous supported video, use a distinctive caption, verify repeat cooldown, and confirm the owner has authorized this specific Reel.

## First real post

1. Keep general automation paused and choose Test publish on that video.
2. Review the dialog, check the authorization box, and click Publish one Reel once.
3. Watch History across cron ticks: queued -> processing -> ready -> publishing -> succeeded. Processing can take minutes. Container ID alone is not success.
4. Record the real returned Instagram media ID, actual timestamp, account username, and verify the Reel on the profile.
5. Confirm the original video remains stored and previewable. This is the first point at which live publishing can be reported as verified.
6. If the outcome is uncertain, inspect the profile and use reconciliation. Never click test again merely because a response was delayed.

## Repeating schedule

After a separate explicit owner start instruction, set 180 minutes, Asia/Kolkata, loop mode, and the chosen cooldown. Eight videos with a 24-hour cooldown normally repeat in order each day. A manual test counts toward that video's cooldown and publish-once eligibility; expect it to be skipped until eligible rather than force an immediate duplicate.

Confirm next_publish_at, successive returned media IDs, queue cursor advancement and wraparound. At three hours per Reel, observing eight videos and a repeat requires more than 24 hours including processing time. Turn the laptop off during the observation and verify cloud history after returning. Pause, wait beyond a slot, and resume: confirm a single current job and no catch-up burst.

## Failure controls

Use automated mocks for network failures, concurrent triggers and ambiguous responses; do not intentionally create duplicate live posts to test recovery. A genuine Meta failure should produce a safe history error/backoff. Three failed jobs pause automation. For a possibly published job, verify Instagram and reconcile the matching recent media ID. If verified absent, use the explicitly labelled cancellation action; resume only after review.

## Acceptance log template

| Criterion                                   | Evidence                                        | Current status                              |
| ------------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| Secure cloud dashboard                      | Approved HTTPS URL, unauthorized API 401        | Blocked: deployment not approved/configured |
| Eight persistent videos                     | R2 inventory and dashboard after redeploy       | Blocked: live R2 configuration              |
| Caption and queue edits                     | Persisted changes after refresh                 | Local API implemented/tested; live pending  |
| Creator authorization                       | Real account username and expiry                | Blocked: Meta app/account setup             |
| One real test Reel                          | Returned media ID and profile verification      | Blocked: credentials and publish approval   |
| Three-hour looping and laptop-off operation | Nine confirmed jobs across >24h                 | Blocked: approved cloud operation           |
| Pause/resume                                | No new scheduled intent while paused            | Local tests pass; live pending              |
| Safe recovery                               | Mock failures and owner reconciliation evidence | Local tests pass; live pending              |
| Automated core coverage                     | npm run check                                   | Implemented                                 |

Do not promote a blocked row to verified without the corresponding evidence.
