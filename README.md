# Loreline

> A page-aware, voice-first reading room for PDF books.

Loreline keeps the book—not a chat box—at the center of the experience. It renders the real PDF, preserves exact text geometry for selections and highlights, and gives a realtime voice companion controlled access to the visible page, the pointer, saved notes, retrieval, navigation, and a visual thinking board.

> [!IMPORTANT]
> Loreline is pre-launch. The architecture is intentionally optimized for decisive iteration: one clean database baseline, no compatibility shims, and strict framework boundaries.

## What works

| Capability | Current implementation |
| --- | --- |
| Faithful PDF reader | PDF.js canvas and text layer share one viewport; zoom, selections, sentence hover, bookmarks, highlights, and notes stay page-accurate |
| Voice-first companion | OpenAI Realtime over browser WebRTC with ten-minute ephemeral client secrets |
| On-demand vision | The agent calls `inspect_page` only when pixels matter; a bounded page image can include the live cursor marker |
| Grounded retrieval | Immediate Postgres full-text search plus resumable OpenRouter embeddings and pgvector HNSW retrieval |
| Durable ingestion | Direct browser-to-R2 upload, server-side PDF validation/extraction, Redis Stream jobs, database progress, retry, and crash recovery |
| Nested library | Shelf and Stack navigation, arbitrary nesting, breadcrumb paths, drag-and-drop moves, and folder-aware uploads |
| Reader workspace | Notes and generated visuals live beside the page; saved notes stay linked to exact highlighted text |
| Private ownership | Better Auth sessions, account-scoped R2 keys, owner checks on every book route, and Redis-backed limits |
| Predictable client state | TanStack Query owns server state, polling, pagination, mutations, invalidation, and global error toasts |

## Quick start

### Local apps with Docker infrastructure

```bash
cp .env.example .env
# Fill the R2 and model credentials you intend to use.

npm install
npm run infra:up
npm run db:migrate
npm run dev
```

Open <http://localhost:3000>. The Next.js web app runs on port `3000`; the standalone Effect API and indexing worker run on `3001`; Postgres and Redis use `5432` and `6379`.

### Full Docker development stack

```bash
npm run docker:dev
```

Both apps hot-refresh from the bind-mounted workspace. The server applies pending migrations before starting. If dependencies changed while the named `loreline_node_modules` volume already existed, synchronize it once:

```bash
docker compose exec web npm install
```

### Production-style Docker stack

```bash
cp .env.example .env.production
# Replace every placeholder and set POSTGRES_PASSWORD + REDIS_PASSWORD.
npm run docker:prod
```

Production builds a Next.js standalone artifact for `apps/web` only. `apps/server` runs the Effect/Node process directly and shuts its HTTP server, managed services, and scoped indexing worker down gracefully.

## Architecture

![Loreline system architecture](docs/architecture.svg)

The separation is enforced, not conventional:

- `apps/web` is the only Next.js application. Its catch-all `/api` route is a same-origin JSON gateway capped at 2 MB and explicitly rejects PDF bodies.
- `apps/server` is an Effect HTTP service on Node using `@effect/platform` and `@effect/platform-node`. It has no Next dependency, config, route tree, runtime import, or build artifact.
- `packages/contracts` owns browser-safe Zod contracts, shared limits, and domain types.
- `packages/database` owns the Drizzle schema, client, row types, and the single pre-launch baseline migration.
- Postgres is authoritative for application and indexing state. Redis provides auth secondary storage, rate limits, and the durable indexing stream. R2 holds private PDF and illustration bytes.

Run the boundary check at any time:

```bash
npm run verify:architecture
```

It fails if Next/React/server-only leaks into `apps/server`, if a detached indexing call returns, if legacy server paths reappear, if loose root server modules or empty source directories exist, or if Docker expects a server-side Next artifact.

### Server layout

```text
apps/server/src
├── main.ts                         process entry; Effect layers and lifecycle
├── api/router.ts                   HTTP routes and Web Request/Response adapter
├── modules
│   ├── auth/                       Better Auth boundary
│   ├── books/
│   │   ├── routes/                 upload, completion, file, item, move, search, retry
│   │   ├── index-queue.ts          Redis Stream producer + supervised consumer
│   │   ├── indexing.ts             leases, batches, retries, persisted progress
│   │   ├── service.ts              book lifecycle and private R2 cleanup
│   │   └── text.ts                 page-accurate sentence chunking
│   ├── folders/
│   │   ├── routes/                 collection, item, move, tree, breadcrumb
│   │   ├── repository.ts           owner-scoped Drizzle queries and recursive CTE
│   │   ├── service.ts              nesting rules and recursive deletion workflow
│   │   └── tree.ts                 pure hierarchy and breadcrumb construction
│   ├── annotations/routes/         highlights, notes, bookmarks
│   ├── ai/
│   │   ├── routes/                 realtime, compaction, illustration endpoints
│   │   ├── providers/              OpenAI/OpenRouter provider boundaries
│   │   └── realtime/               typed ephemeral-session contract
│   └── system/                     health checks
└── platform/                       config, HTTP errors, Redis, managed services
```

### Shelf, Stacks, and deletion

The Shelf is the root view; it is not a separate database row. A Stack is an owner-scoped `folders` row, and `parent_id` creates arbitrary nesting:

```text
Shelf
└── Work                    folders: work.parent_id = NULL
    └── History             folders: history.parent_id = work
        └── history-notes.pdf  books: folder_id = history
```

Card counters intentionally show direct children. The delete dialog asks the server for a recursive subtree summary, requires the exact Stack name, and the delete request resolves that subtree again rather than trusting cached UI counts. Every affected book prefix is cleared from R2; Postgres cascades the confirmed root deletion through nested Stacks and dependent book data.

## PDF upload and RAG

![Loreline PDF ingestion and retrieval flow](docs/pdf-rag-flow.svg)

The upload request and the expensive index job are deliberately separate:

1. The browser submits PDF metadata to the Effect API through the bounded Next.js gateway.
2. The API verifies the session, rate limit, MIME, size, and account-scoped object key, then returns a ten-minute R2 presigned `PUT` URL.
3. The browser uploads the PDF bytes directly to private R2. R2 credentials and the PDF body never pass through Next.js.
4. The browser calls the completion endpoint. The server checks the stored byte count and `%PDF-` magic bytes, extracts every page, and writes page-accurate chunks in one transaction.
5. The book becomes readable immediately. Postgres full-text search is available as soon as chunks exist.
6. The API appends `{bookId,userId}` to a Redis Stream and returns. A supervised Effect worker claims the job and embeds batches of 16 passages.
7. Each successful batch stores vectors and authoritative progress. Retries resume only chunks whose embedding is still null.
8. Search fuses lexical and semantic rankings. If OpenRouter is unavailable, lexical retrieval continues instead of making the book unusable.

Chunks target 2,600 characters with a 260-character sentence overlap. They never cross PDF pages, so retrieved passages retain exact page identity for navigation and highlighting.

### Why Redis Streams here?

A Redis string/list is just data at a key. A Redis Stream is an append-only, ordered log of entries with unique IDs. A consumer group adds queue behavior:

- `XADD` persists an indexing job to the log before the HTTP request returns.
- `XREADGROUP` gives each new entry to one consumer in the group, distributing work across server instances.
- Claimed work stays in the pending-entry list until the worker sends `XACK`; merely reading it does not delete it.
- If a process dies, `XAUTOCLAIM` transfers sufficiently old pending work to a live consumer.
- Loreline also takes a 15-minute Postgres lease and writes progress per batch. Duplicate delivery is therefore safe and an interrupted job resumes instead of re-embedding completed chunks.
- After acknowledgement, Loreline deletes the processed stream entry and approximately caps the stream at 10,000 entries. Redis runs with AOF persistence and `noeviction` in the supplied Docker stacks.

This is similar to a lightweight message queue, but it is not identical to RabbitMQ, SQS, or Kafka. Redis Streams supplies an ordered log, consumer groups, acknowledgements, and pending recovery; Loreline supplies retries, idempotency, leases, progress, and failure state in application code. The resulting guarantee is **at-least-once delivery with idempotent processing**, not magical exactly-once execution.

## Realtime context and long sessions

The voice agent receives compact live text context: book title, current page, visible extracted text, current selection, saved passages on that page, and any compacted conversation memory. A page bitmap is never pushed merely because the cursor or page moved.

Available browser-side tools are:

- `inspect_page` — capture the full rendered page on demand, optionally with the live pointer visibly marked.
- `search_book` — retrieve passages outside the visible page through hybrid RAG.
- `focus_passage` — focus exact text in the PDF.
- `turn_page` — handle explicit next/previous navigation.
- `save_highlight_note` — persist a note against an exact passage.
- `place_note` and `place_visual` — add artifacts to the side workspace.

There is no literal unlimited context window. At 95% of the configured Realtime conversation budget, the browser asks the server to compact completed turns into strict structured memory through the configured cheap OpenRouter model. That memory is placed into the agent instructions, summarized history is removed, and current page context remains primary. Realtime’s 70% retention-ratio truncation is a final safety net if compaction is delayed or unavailable.

## Configuration

Copy `.env.example` to `.env`. Never put real secrets in committed files.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection used by Drizzle |
| `REDIS_URL` | Yes | Auth cache, rate limits, and index stream |
| `SERVER_INTERNAL_URL` | Yes | Next.js gateway → Effect API address |
| `BETTER_AUTH_SECRET` | Yes outside throwaway local dev | Session signing; use at least 32 random characters |
| `BETTER_AUTH_URL` | Yes | Canonical application origin |
| `NEXT_PUBLIC_APP_URL` | Yes | Trusted browser origin |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional pair | Google OAuth provider |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account containing the private bucket |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Yes | Bucket-scoped Object Read & Write token |
| `R2_BUCKET_NAME` | Yes | Private PDF/illustration bucket |
| `OPENAI_API_KEY` | For voice | Mints short-lived Realtime client secrets |
| `OPENAI_REALTIME_MODEL` | No | Defaults to `gpt-realtime-2.1-mini` |
| `OPENROUTER_API_KEY` | For RAG/visuals/memory | Embeddings, low-quality illustrations, and compaction |
| `OPENROUTER_EMBEDDING_MODEL` | No | Defaults to `openai/text-embedding-3-small` |
| `OPENROUTER_IMAGE_MODEL` | No | Defaults to `openai/gpt-image-2`; requests use `quality: low` |
| `OPENROUTER_COMPACTION_MODEL` | No | Defaults to `deepseek/deepseek-v4-flash` |
| `TAVILY_API_KEY` | For live web search | Recent or outside-book facts requested through Realtime voice |

For local Google OAuth, configure this exact authorized redirect URI in Google Cloud:

```text
http://localhost:3000/api/auth/callback/google
```

## Security and limits

- PDFs are capped at 50 MB at the shared contract, API, signed upload, and UI boundaries.
- Object keys begin with `users/{userId}/books/{bookId}/`; book routes always re-check the authenticated owner.
- Folder parent and book-folder links use composite owner foreign keys, so Postgres rejects cross-account nesting even if application validation regresses.
- Deleting a book or confirmed Stack clears its complete private R2 prefix. Stack deletion recursively cascades its database books, child Stacks, chunks, highlights, notes, bookmarks, and illustration records.
- Completion verifies exact R2 byte count, MIME intent, and PDF magic bytes before parsing.
- Unknown failures are logged server-side and return a generic message. Only deliberate `HttpError`/`UserFacingError` text reaches users.
- OpenRouter requests deny provider data collection where supported. Model API keys stay server-side.
- Realtime clients receive a scoped ten-minute `ek_…` secret, never the long-lived OpenAI key.

| Expensive boundary | Limit per user |
| --- | ---: |
| Begin/complete PDF upload | 10/hour each |
| Manual index retry | 20/hour |
| Realtime client secret | 20/hour |
| Conversation compaction | 24/hour |
| Illustration generation | 12/hour |
| Hybrid book search | 90/hour |
| Highlights | 180/hour |
| Bookmarks | 120/hour |

## Development commands

```bash
npm run dev                  # Next web + Effect server
npm run typecheck            # strict TypeScript across workspaces
npm run lint                 # zero-warning ESLint
npm test -- --run            # focused unit/contract tests
npm run test:e2e             # critical rendered browser flows
npm run verify:architecture  # enforce framework and structure boundaries
npm run build                # production web + server validation
npm run db:generate          # regenerate migration after schema changes
npm run db:migrate           # apply pending Drizzle migrations
npm run db:studio            # inspect Postgres
npm run infra:up             # start Postgres + Redis
npm run infra:down           # stop local infrastructure
```

## Troubleshooting

### Docker reports a package missing after `npm install`

The named `/app/node_modules` volume overrides dependencies baked into the image. Run:

```bash
docker compose exec web npm install
docker compose --profile app up -d --build server web
```

### A book is readable but grounded search is still building

This is expected for a large book. The library card polls persisted progress while the Redis consumer embeds batches. If it changes to **Grounded search paused**, use **Retry search index**; completed vectors are preserved.

Inspect the queue directly:

```bash
docker compose exec redis redis-cli XINFO GROUPS loreline:book-index
docker compose exec redis redis-cli XPENDING loreline:book-index loreline-indexers
```

### A PDF fails during preparation

Loreline keeps the private upload and displays the deliberate parsing failure. Verify the file is an unlocked PDF under 50 MB, then use **Resume preparation**. Image-only/scanned PDFs need OCR, which is not implemented yet.

### R2 health is degraded

Confirm all four `R2_*` values describe the same private bucket and bucket-scoped token. `GET /api/health` verifies Postgres, Redis, and R2 without exposing credentials.

### Voice initially fails or cannot connect

Confirm `OPENAI_API_KEY`, the configured Realtime model, microphone permission, and WebRTC connectivity. The browser creates page images only after an `inspect_page` tool call, avoiding oversized RTC data-channel messages.

### Google reports a redirect mismatch or missing provider

Set both Google variables, restart the Effect server, and ensure the exact callback above is authorized. The provider is deliberately omitted when either credential is absent.

## Current limitations

- OCR is not yet available for scanned/image-only PDFs.
- Lexical FTS currently uses PostgreSQL’s English configuration; multilingual semantic embeddings still work, but language-specific lexical analyzers are future work.
- The 50 MB upload ceiling is deliberate.
- This is a pre-launch system; deployment automation and observability beyond structured Effect HTTP logs are still evolving.
