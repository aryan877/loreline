@AGENTS.md

Follow `AGENTS.md` as the source of truth. In particular, do not use subagents unless the user explicitly requests them, and remove superseded pre-launch code instead of preserving legacy paths.

`apps/web` is the only Next.js app. `apps/server` is an Effect/Node HTTP service with a supervised Redis Stream indexing worker; never add Next packages, imports, routes, config, or `.next` output to it. Run `npm run verify:architecture` whenever that boundary or server structure changes.

When dependencies change under Docker development, remember that the named `/app/node_modules` volume overrides dependencies baked into the image. Refresh it with `docker compose exec web npm install` after rebuilding.

PDF uploads are true browser-to-R2 presigned `PUT` requests. The authenticated Effect API authorizes metadata and signs the URL; Next.js only forwards bounded JSON. Do not introduce an upload proxy or Worker gateway.

Postgres owns indexing truth and progress. Redis Streams provide at-least-once job delivery; the database lease, null-vector resume, and per-batch commits make retries safe. Do not move embedding back into the completion request or fire detached work from a handler.

Shared contracts belong in `packages/contracts`, the schema and clean migration baseline belong in `packages/database`, and README architecture diagrams under `docs/` must change with the implementation.
