# Agent instructions

ReelLoop is a single-owner Instagram automation app, using the official Instagram API with Instagram Login. Prefer the existing stack and small explicit state transitions. Keep publishing paused in initial migrations. No browser-login bots, unofficial API endpoints, AI dependencies, or production fake success responses.

Do not deploy, create cloud resources, change paid plans, or publish a real Reel without explicit owner authorization. Local development, tests, mocks, and deploy dry-runs are permitted. Never print secrets or commit .dev.vars, .env, session cookies or encrypted token data. Keep request query strings out of provider logs.

Use `npm run check` after meaningful changes. Tests use local D1/R2 and the injected Meta adapter. Assert persistence and failure behavior, not just implementation calls. Use dry-run Wrangler packaging after backend changes. Keep the lockfile and exact package versions current; document compatibility changes.

Preserve these invariants: one active job per account; lease-fenced state changes; immutable caption snapshots; no publishing until processing is FINISHED; persist a publish intent before the POST; never retry an uncertain publish; only real media IDs mark success; originals are never automatically removed after publication. Update relevant tests and docs when changing behavior.

The default timezone is Asia/Kolkata. Store UTC epoch milliseconds; display using the selected IANA timezone. Live integration claims require evidence of an authorized successful post. Record external blockers honestly in docs/IMPLEMENTATION_STATUS.md.
