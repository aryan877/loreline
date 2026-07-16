<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Loreline working rules

- Do not create or delegate to subagents unless the user explicitly asks for subagents or parallel agent work.
- Loreline is pre-launch. Prefer decisive cleanup over compatibility layers: delete replaced code, dead branches, stale dependencies, and obsolete environment variables.
- Keep the code lean, strict, and DRY. Never use `as never`; model SDK and contract types correctly.
- Shared database schema, domain types, limits, and API contracts live under `src/shared` and are imported by both client and server.
- Use TanStack Query for client server-state. Global query and mutation failures flow through `src/lib/toast-error.ts`; do not add one-off raw error displays.
- Only `UserFacingError` or deliberate `HttpError` messages may reach users. Log unknown failures server-side and return a clean generic message.
- PDF bytes upload directly from the browser to Cloudflare R2 using short-lived S3-compatible presigned URLs issued by Next.js. Never proxy upload bodies through Next.js and never expose R2 credentials to browser code.
- Preserve the 50 MB PDF limit, account-scoped object keys, upload rate limits, MIME checks, and PDF magic-byte validation.
- Use theme tokens from `src/app/globals.css`; do not hardcode product colors in components.
- Run `npm run typecheck`, `npm run lint`, and `npm test -- --run` after meaningful changes. Use Playwright for rendered UI and critical-flow verification.
- Docker development mounts the named `loreline_node_modules` volume over the image’s `/app/node_modules`. After adding or removing a dependency, run `docker compose exec web npm install` (or deliberately recreate that volume) in addition to rebuilding; otherwise the container can report a missing package even when the image and lockfile are correct.
- Never commit or print real secrets. Keep `.env.example` descriptive and secret-free.
