import { and, cosineDistance, desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { bookChunks } from "@loreline/database/schema";
import {
  searchBookInputSchema,
  searchBookResponseSchema,
  type SearchResult,
} from "@loreline/contracts/ai";
import { ownedBook } from "@/modules/books/text";
import { apiError, assertRateLimit, requireSession } from "@/platform/http";
import { DatabaseService, runServerEffect } from "@/platform/services";
import { AppConfigTag } from "@/platform/config";
import { createOpenRouterEmbeddings } from "@/modules/ai/providers/openrouter";

function mergeRankedResults(
  semantic: SearchResult[],
  lexical: SearchResult[],
  limit: number,
) {
  const results = new Map<
    string,
    { result: SearchResult; score: number }
  >();
  const add = (result: SearchResult, score: number) => {
    const key = `${result.pageStart}:${result.pageEnd}:${result.content}`;
    const existing = results.get(key);
    results.set(key, {
      result,
      score: (existing?.score ?? 0) + score,
    });
  };
  semantic.forEach((result, rank) => add(result, 0.7 / (60 + rank + 1)));
  lexical.forEach((result, rank) => add(result, 0.3 / (60 + rank + 1)));
  return [...results.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ result, score }) => ({ ...result, similarity: score }));
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    await assertRateLimit(`search:${session.user.id}`, 90, 60 * 60 * 1000);
    const input = searchBookInputSchema.parse(await request.json());
    const result = await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(input.bookId, session.user.id);
        const { db } = yield* DatabaseService;
        const config = yield* AppConfigTag;
        const candidateLimit = Math.min(input.limit * 3, 36);
        const lexicalRank = sql<number>`ts_rank_cd(
          ${bookChunks.searchVector},
          websearch_to_tsquery('english', ${input.query})
        )`;
        const lexical = yield* Effect.tryPromise(() =>
          db
            .select({
              pageStart: bookChunks.pageStart,
              pageEnd: bookChunks.pageEnd,
              content: bookChunks.content,
              similarity: lexicalRank,
            })
            .from(bookChunks)
            .where(
              and(
                eq(bookChunks.bookId, input.bookId),
                eq(bookChunks.userId, session.user.id),
                sql`${bookChunks.searchVector} @@ websearch_to_tsquery('english', ${input.query})`,
              ),
            )
            .orderBy(desc(lexicalRank))
            .limit(candidateLimit),
        );

        const semantic = yield* Effect.tryPromise(async () => {
          if (
            book.indexingStatus !== "ready" ||
            !config.openRouterApiKey
          ) {
            return [];
          }
          const [vector] = await createOpenRouterEmbeddings(input.query, {
            apiKey: config.openRouterApiKey,
            model: config.openRouterEmbeddingModel,
          });
          if (!vector) return [];
          const similarity = sql<number>`1 - (${cosineDistance(bookChunks.embedding, vector)})`;
          return db
            .select({
              pageStart: bookChunks.pageStart,
              pageEnd: bookChunks.pageEnd,
              content: bookChunks.content,
              similarity,
            })
            .from(bookChunks)
            .where(
              and(
                eq(bookChunks.bookId, input.bookId),
                eq(bookChunks.userId, session.user.id),
                sql`${bookChunks.embedding} is not null`,
              ),
            )
            .orderBy(desc(similarity))
            .limit(candidateLimit);
        }).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.error(
                "Loreline semantic search fell back to text search",
                { bookId: input.bookId, error },
              );
              return [];
            }),
          ),
        );
        return mergeRankedResults(semantic, lexical, input.limit);
      }),
    );
    return Response.json(
      searchBookResponseSchema.parse({ results: result }),
    );
  } catch (error) {
    return apiError(error);
  }
}
