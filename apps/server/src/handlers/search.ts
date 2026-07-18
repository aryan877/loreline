import { and, cosineDistance, desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { bookChunks } from "@loreline/database/schema";
import {
  searchBookInputSchema,
  searchBookResponseSchema,
} from "@loreline/contracts/ai";
import { ownedBook } from "@/book-utils";
import { apiError, assertRateLimit, HttpError, requireSession } from "@/http";
import { DatabaseService, runServerEffect } from "@/services";
import { AppConfigTag } from "@/config";
import { createOpenRouterEmbeddings } from "@/openrouter-client";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    await assertRateLimit(`search:${session.user.id}`, 90, 60 * 60 * 1000);
    const input = searchBookInputSchema.parse(await request.json());
    const result = await runServerEffect(
      Effect.gen(function* () {
        yield* ownedBook(input.bookId, session.user.id);
        const { db } = yield* DatabaseService;
        const config = yield* AppConfigTag;
        if (!config.openRouterApiKey)
          return yield* Effect.fail(
            new HttpError(503, "Book search is not available yet."),
          );
        const [vector] = yield* Effect.tryPromise(() =>
          createOpenRouterEmbeddings(input.query, {
            apiKey: config.openRouterApiKey!,
            model: config.openRouterEmbeddingModel,
          }),
        );
        if (!vector) return [];
        const similarity = sql<number>`1 - (${cosineDistance(bookChunks.embedding, vector)})`;
        return yield* Effect.tryPromise(() =>
          db
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
              ),
            )
            .orderBy(desc(similarity))
            .limit(input.limit),
        );
      }),
    );
    return NextResponse.json(
      searchBookResponseSchema.parse({ results: result }),
    );
  } catch (error) {
    return apiError(error);
  }
}
