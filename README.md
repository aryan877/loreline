# Loreline

**Read past the words.** Loreline is a page-aware AI reading room for PDF books. It keeps the visible page, selection, and mouse pointer as primary context; realtime voice and semantic retrieval sit around the book instead of replacing it.

## What already works

| Capability            | Implementation                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Private library       | Better Auth ownership checks, Postgres catalog, private R2-compatible object keys           |
| PDF reading           | PDF.js rendering, text layer, selection, pointer coordinates, page screenshots              |
| Realtime voice        | OpenAI Agents SDK `RealtimeAgent` + `RealtimeSession` over browser WebRTC                   |
| Visual sideboard      | Agent tools can pin notes, search the book, and generate multiple GPT Image 2 visuals       |
| Page-first answers    | Visible text/image/selection/pointer first; pgvector RAG only when the page is insufficient |
| Production boundaries | Effect services, Drizzle migrations, Redis limits, Zod validation, cursor pagination        |
| UI state              | TanStack Query for server state, mutations, infinite pagination, and cache invalidation     |
| Local operations      | Dockerized pgvector Postgres and Redis; signed browser-to-R2 PDF uploads                   |

## Quick start

### Native Next.js + Docker infrastructure

```bash
npm install
npm run infra:up
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. Postgres runs on `5432`; Redis runs on `6379`.

### Everything in Docker

```bash
npm run docker:dev
```

The development container applies migrations and starts Next.js with hot reload. PDF bytes upload directly from the browser to private R2 objects.

### Production-style stack

```bash
cp .env.example .env.production
# Fill the required production secrets.
npm run docker:prod
```

The production image uses Next.js standalone output, runs as an unprivileged user, waits for healthy Postgres/Redis, and applies Drizzle migrations before starting the web service.

## AI context hierarchy

```text
Visible PDF page image + extracted page text
                    ↓
       selection + pointer location
                    ↓
        current voice/chat question
                    ↓
  search_book tool / pgvector RAG (optional)
                    ↓
 spoken answer + sideboard notes/images
```

The realtime agent has three browser-side tools:

- `search_book` retrieves other passages only when the current page is insufficient.
- `place_note` pins definitions, quotes, comparisons, or steps without forcing the user to read a chat transcript.
- `place_visual` calls the protected image endpoint and pins one or more low-quality GPT Image 2 illustrations to the board.

## Configuration

Copy `.env.example` to `.env`. The private `loreline-books` bucket uses a bucket-scoped Object Read & Write token.

| Variable                  | Required   | Purpose                                                     |
| ------------------------- | ---------- | ----------------------------------------------------------- |
| `OPENAI_API_KEY`          | For AI     | Responses, embeddings, Realtime client secrets, GPT Image 2 |
| `R2_ACCOUNT_ID`           | Yes        | Cloudflare account containing the private R2 bucket          |
| `R2_ACCESS_KEY_ID`        | Yes        | Bucket-scoped S3-compatible access key                       |
| `R2_SECRET_ACCESS_KEY`    | Yes        | Bucket-scoped S3-compatible secret                           |
| `R2_BUCKET_NAME`          | Yes        | Private PDF bucket                                           |
| `BETTER_AUTH_SECRET`      | Production | Session signing; use 32+ cryptographically random bytes     |
| `DATABASE_URL`            | Yes        | Postgres connection string                                  |
| `REDIS_URL`               | Yes        | Distributed rate limits and Better Auth secondary storage   |
| `BETTER_AUTH_URL`         | Yes        | Canonical deployed origin                                   |
| `NEXT_PUBLIC_APP_URL`     | Yes        | Browser-facing application origin                           |
| `GOOGLE_CLIENT_ID/SECRET` | Optional   | Google sign-in                                              |

The checked-in model defaults are:

```dotenv
OPENAI_CHAT_MODEL=gpt-5.6-luna
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

## Important commands

```bash
npm run typecheck        # TypeScript contracts
npm test                 # Three focused mocked SDK/policy tests
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
Next.js App Router
├── Landing, auth, library, PDF reader, sideboard
├── TanStack Query server-state, mutations, and cursor pagination
├── Shared Zod contracts + DTOs (browser ↔ API)
├── Better Auth route + Redis secondary storage
└── Effect-powered API programs
    ├── Drizzle → Postgres + pgvector
    ├── Storage service → Cloudflare R2 S3-compatible API
    └── OpenAI service
        ├── Responses API (grounded text)
        ├── Agents SDK + Realtime API (voice)
        ├── Embeddings (secondary RAG)
        └── GPT Image 2 (visual board)
```

The shared data package lives under [`src/shared`](src/shared). It owns the Drizzle tables and client in [`src/shared/db`](src/shared/db), inferred row/insert models, and the Zod API schemas in [`src/shared/contracts`](src/shared/contracts). `drizzle-zod` derives book, chunk, message, conversation, and illustration contracts from those tables; API routes parse their output through the shared response schemas, while browser code imports the inferred DTO types. Runtime services live in [`src/server/services.ts`](src/server/services.ts); realtime tool orchestration lives in [`src/hooks/use-loreline-voice.ts`](src/hooks/use-loreline-voice.ts).

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
