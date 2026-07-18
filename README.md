# Loreline

**Read past the words.** Loreline is a page-aware AI reading room for PDF books. It keeps the visible page, selection, and mouse pointer as primary context; realtime voice and semantic retrieval sit around the book instead of replacing it.

## What already works

| Capability            | Implementation                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Private library       | Better Auth ownership checks, Postgres catalog, private R2-compatible object keys         |
| PDF reading           | PDF.js rendering, text layer, selection, pointer coordinates, on-demand page inspection   |
| Realtime voice        | OpenAI Agents SDK `RealtimeAgent` + `RealtimeSession` over browser WebRTC                 |
| Visual sideboard      | Agent tools can pin notes, search the book, and generate illustrations through OpenRouter |
| Page-first answers    | Visible text/selection first; bounded page images and pgvector RAG only when needed       |
| Production boundaries | Effect services, Drizzle migrations, Redis limits, Zod validation, cursor pagination      |
| UI state              | TanStack Query for server state, mutations, infinite pagination, and cache invalidation   |
| Local operations      | Dockerized pgvector Postgres and Redis; signed browser-to-R2 PDF uploads                  |

## Quick start

### Native apps + Docker infrastructure

```bash
npm install
npm run infra:up
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. Turborepo starts the web app on `3000` and the
API server on `3001`; Postgres runs on `5432` and Redis on `6379`.

### Everything in Docker

```bash
npm run docker:dev
```

The development stack applies migrations and starts both apps with hot reload.
PDF bytes upload directly from the browser to private R2 objects.

### Production-style stack

```bash
cp .env.example .env.production
# Fill the required production secrets.
npm run docker:prod
```

The production image uses Next.js standalone output, runs as an unprivileged user, waits for healthy Postgres/Redis, and applies Drizzle migrations before starting the web service.

## AI context hierarchy

```text
      Extracted visible page text + selection
                       ↓
              current spoken request
                       ↓
 inspect_page at pointer/page when pixels are needed
                       ↓
      search_book / pgvector only when needed
                       ↓
        spoken answer + sideboard artifacts
```

The realtime agent has focused browser-side tools:

- `inspect_page` captures a bounded PDF canvas image only when visual inspection is needed.
- `search_book` retrieves other passages only when the current page is insufficient.
- `focus_passage` visibly focuses the exact words being discussed.
- `turn_page` handles explicit spoken next/previous navigation.
- `save_highlight_note` persists a note linked to an exact PDF passage.
- `place_note` pins a temporary freeform note to the sideboard.
- `place_visual` calls the protected illustration endpoint and pins the result to the board.

## Configuration

Copy `.env.example` to `.env`. The private `loreline-books` bucket uses a bucket-scoped Object Read & Write token.

| Variable                  | Required   | Purpose                                                   |
| ------------------------- | ---------- | --------------------------------------------------------- |
| `OPENAI_API_KEY`          | For voice  | Realtime client secrets                                   |
| `OPENROUTER_API_KEY`      | For AI     | Compaction, illustrations, and book retrieval embeddings  |
| `R2_ACCOUNT_ID`           | Yes        | Cloudflare account containing the private R2 bucket       |
| `R2_ACCESS_KEY_ID`        | Yes        | Bucket-scoped S3-compatible access key                    |
| `R2_SECRET_ACCESS_KEY`    | Yes        | Bucket-scoped S3-compatible secret                        |
| `R2_BUCKET_NAME`          | Yes        | Private PDF bucket                                        |
| `BETTER_AUTH_SECRET`      | Production | Session signing; use 32+ cryptographically random bytes   |
| `DATABASE_URL`            | Yes        | Postgres connection string                                |
| `REDIS_URL`               | Yes        | Distributed rate limits and Better Auth secondary storage |
| `SERVER_INTERNAL_URL`     | Yes        | Server app URL used by the web gateway                    |
| `BETTER_AUTH_URL`         | Yes        | Canonical deployed origin                                 |
| `NEXT_PUBLIC_APP_URL`     | Yes        | Browser-facing application origin                         |
| `GOOGLE_CLIENT_ID/SECRET` | Optional   | Google sign-in                                            |

The checked-in model defaults are:

```dotenv
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENROUTER_COMPACTION_MODEL=deepseek/deepseek-v4-flash
OPENROUTER_IMAGE_MODEL=openai/gpt-image-1-mini
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
```

## Important commands

```bash
npm run typecheck        # TypeScript contracts
npm test -- --run        # Focused contract, policy, and SDK unit tests
npm run test:e2e         # One rendered web/server smoke flow
npm run lint             # Next.js + React lint rules
npm run build            # Production Next.js build
npm run db:generate      # Generate a migration after schema changes
npm run db:migrate       # Apply pending Drizzle migrations
npm run db:studio        # Inspect local Postgres
npm run infra:down       # Stop local infrastructure
```

## API boundaries

All book-specific routes verify the authenticated owner. Collection endpoints use bounded limits and cursor pagination. Expensive endpoints use Redis-backed fixed-window limits:

| Boundary                | Current limit |
| ----------------------- | ------------: |
| PDF uploads             |  10/hour/user |
| Realtime client secrets |  20/hour/user |
| GPT Image visuals       |  12/hour/user |
| Text questions          |  60/hour/user |
| Semantic searches       |  90/hour/user |

Uploads use 10-minute, account-scoped signed URLs, accept PDF signatures only, and cap files at 50 MB. The browser transfers bytes directly to Cloudflare; R2 objects remain private and `/api/books/:id/file` reads a book only after ownership verification.

## Architecture

```text
apps/web (Next.js, port 3000)
├── Landing, auth UI, library, PDF reader, sideboard
├── TanStack Query server-state and mutations
└── Same-origin /api gateway (2 MB cap; rejects PDF upload bodies)

apps/server (Next.js API app, port 3001)
├── Better Auth + Redis limits
└── Effect services → Postgres, R2, and OpenAI

packages/contracts   Browser-safe Zod contracts, domain types, and limits
packages/database    Drizzle schema, client, migrations, and row types
packages/*-config    Shared TypeScript, ESLint, and Next standalone tooling
```

The package graph is explicit in the workspace manifests. Browser-safe contracts
live in [`packages/contracts`](packages/contracts), while Drizzle and migrations
live in [`packages/database`](packages/database). The server app owns auth,
transport handlers, and runtime services; the web app never imports server code.

## Current limitations

- `OPENAI_API_KEY` is intentionally empty, so AI buttons return a clear setup response until it is added.
- OCR for image-only/scanned PDFs is not included yet.
- Background ingestion is synchronous in this first build. Move extraction/embedding to a queue before accepting very large public traffic.

## Troubleshooting

### AI says to add `OPENAI_API_KEY`

Add the key to `.env` and restart Next.js. Long-lived keys never enter the browser; realtime voice receives a 10-minute `ek_…` client secret.

### R2 health is degraded

Confirm the four `R2_*` values match the bucket-scoped token. `/api/health` verifies the bucket and reports `storage: "r2"`.

### Postgres reports that `vector` does not exist

Use the provided `pgvector/pgvector:pg17` image and run `npm run db:migrate`. The first migration installs the vector extension before creating the HNSW index.

### Redis is unavailable

Run `npm run infra:up`. Development has a process-local fallback; production fails closed on expensive routes when Redis is unavailable.

### A PDF renders but has no searchable context

The file is probably scanned. It can still be read visually, but semantic retrieval requires OCR in a later ingestion worker.
