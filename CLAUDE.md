@AGENTS.md

Follow `AGENTS.md` as the source of truth. In particular, do not use subagents unless the user explicitly requests them, and remove superseded pre-launch code instead of preserving legacy paths.

When dependencies change under Docker development, remember that the named `/app/node_modules` volume overrides dependencies baked into the image. Refresh it with `docker compose exec web npm install` after rebuilding.

PDF uploads are true browser-to-R2 presigned `PUT` requests. Next.js authorizes and signs metadata only; do not introduce an upload proxy or Worker gateway.
