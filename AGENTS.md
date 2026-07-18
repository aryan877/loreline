<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Loreline working rules

- Do not create or delegate to subagents unless the user explicitly asks for subagents or parallel agent work.
- Loreline is pre-launch. Prefer decisive cleanup over compatibility layers: delete replaced code, dead branches, stale dependencies, and obsolete environment variables.
- Keep the code lean, strict, and DRY. Never use `as never`; model SDK and contract types correctly.
- `apps/web` is the only Next.js application. `apps/server` is a standalone Effect/Node service built with `@effect/platform` and `@effect/platform-node`; it must never contain a Next dependency, config, route tree, runtime import, or build artifact. Run `npm run verify:architecture` after server-structure changes.
- Structure server code by feature under `src/modules`; keep transport composition in `src/api`, infrastructure in `src/platform`, and only the process entry at the `src` root. Do not recreate generic handler buckets or loose root modules.
- Long-lived server services use the shared Effect `ManagedRuntime`. Background work must be supervised by the Effect lifecycle; never launch detached promises from request handlers.
- Shared domain types, limits, and API contracts live in `packages/contracts`; the database schema and client live in `packages/database`. Both apps import them through package exports.
- Postgres is authoritative for book/indexing state. Redis Streams distribute durable indexing jobs with consumer-group acknowledgements and stale-pending recovery; database leases and per-batch progress make delivery idempotent. Do not replace this with synchronous request indexing or `void indexBook(...)`.
- Use TanStack Query for client server-state. Global query and mutation failures flow through `src/lib/toast-error.ts`; do not add one-off raw error displays.
- Only `UserFacingError` or deliberate `HttpError` messages may reach users. Log unknown failures server-side and return a clean generic message.
- PDF bytes upload directly from the browser to Cloudflare R2 using short-lived S3-compatible presigned URLs issued by the authenticated Effect API. Next.js forwards metadata/JSON only; never proxy upload bodies through either app and never expose R2 credentials to browser code.
- Preserve the 50 MB PDF limit, account-scoped object keys, upload rate limits, MIME checks, and PDF magic-byte validation.
- Keep retrieval usable while embeddings build: page-accurate text chunks and Postgres FTS are immediate; semantic vectors are resumable and hybrid-ranked when ready.
- The checked-in Drizzle history is a clean pre-launch baseline. When the user explicitly authorizes a data reset, prefer a truthful new baseline over legacy backfills; otherwise generate forward-only migrations normally.
- Use theme tokens from `src/app/globals.css`; do not hardcode product colors in components.
- Run `npm run typecheck`, `npm run lint`, and `npm test -- --run` after meaningful changes. Use Playwright for rendered UI and critical-flow verification.
- Keep `README.md` and the SVGs under `docs/` accurate when architecture, ingestion, model, or deployment behavior changes.
- Docker development mounts the named `loreline_node_modules` volume over the image’s `/app/node_modules`. After adding or removing a dependency, run `docker compose exec web npm install` (or deliberately recreate that volume) in addition to rebuilding; otherwise the container can report a missing package even when the image and lockfile are correct.
- Never commit or print real secrets. Keep `.env.example` descriptive and secret-free.
