import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { bookChunks, books } from "@loreline/database/schema";
import { AppConfigTag } from "@/platform/config";
import {
  createOpenRouterEmbeddings,
  OpenRouterRequestError,
} from "@/modules/ai/providers/openrouter";
import { DatabaseService, runServerEffect } from "@/platform/services";

const EMBEDDING_BATCH_SIZE = 16;
const INDEXING_LEASE_MS = 15 * 60 * 1_000;
const RETRY_DELAYS_MS = [500, 1_500, 4_000] as const;
const INDEXING_FAILURE_MESSAGE =
  "Semantic search needs another try. Your PDF is still available.";

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function embedBatch(
  content: string[],
  options: { apiKey: string; model: string },
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await createOpenRouterEmbeddings(content, options);
    } catch (error) {
      lastError = error;
      const retryable =
        !(error instanceof OpenRouterRequestError) ||
        error.status === 429 ||
        error.status >= 500;
      if (!retryable || attempt === RETRY_DELAYS_MS.length) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

export async function indexBook(bookId: string, userId: string) {
  const { db, config } = await runServerEffect(
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const config = yield* AppConfigTag;
      return { db, config };
    }),
  );
  const staleBefore = new Date(Date.now() - INDEXING_LEASE_MS);
  const now = new Date();
  const [claimed] = await db
    .update(books)
    .set({
      indexingStatus: "indexing",
      indexingAttempts: sql`${books.indexingAttempts} + 1`,
      indexingError: null,
      indexingUpdatedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(books.id, bookId),
        eq(books.userId, userId),
        eq(books.status, "ready"),
        sql`${books.totalChunks} > 0`,
        or(
          eq(books.indexingStatus, "pending"),
          eq(books.indexingStatus, "failed"),
          and(
            eq(books.indexingStatus, "indexing"),
            lt(books.indexingUpdatedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning({ totalChunks: books.totalChunks });

  if (!claimed) return;

  try {
    if (!config.openRouterApiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }

    const pendingChunks = await db
      .select({
        id: bookChunks.id,
        content: bookChunks.content,
      })
      .from(bookChunks)
      .where(
        and(
          eq(bookChunks.bookId, bookId),
          eq(bookChunks.userId, userId),
          isNull(bookChunks.embedding),
        ),
      )
      .orderBy(bookChunks.pageStart, bookChunks.id);

    const alreadyIndexed = claimed.totalChunks - pendingChunks.length;
    for (
      let offset = 0;
      offset < pendingChunks.length;
      offset += EMBEDDING_BATCH_SIZE
    ) {
      const batch = pendingChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const embeddings = await embedBatch(
        batch.map((chunk) => chunk.content),
        {
          apiKey: config.openRouterApiKey,
          model: config.openRouterEmbeddingModel,
        },
      );
      const indexedChunks = alreadyIndexed + offset + batch.length;
      const updatedAt = new Date();
      await db.transaction(async (transaction) => {
        for (const [index, chunk] of batch.entries()) {
          await transaction
            .update(bookChunks)
            .set({ embedding: embeddings[index] })
            .where(
              and(
                eq(bookChunks.id, chunk.id),
                eq(bookChunks.bookId, bookId),
                eq(bookChunks.userId, userId),
              ),
            );
        }
        await transaction
          .update(books)
          .set({
            indexedChunks,
            indexingUpdatedAt: updatedAt,
            updatedAt,
          })
          .where(and(eq(books.id, bookId), eq(books.userId, userId)));
      });
    }

    const completedAt = new Date();
    await db
      .update(books)
      .set({
        indexingStatus: "ready",
        indexedChunks: claimed.totalChunks,
        indexingError: null,
        indexingUpdatedAt: completedAt,
        updatedAt: completedAt,
      })
      .where(and(eq(books.id, bookId), eq(books.userId, userId)));
  } catch (error) {
    console.error("Loreline book indexing failed", { bookId, error });
    const failedAt = new Date();
    await db
      .update(books)
      .set({
        indexingStatus: "failed",
        indexingError: INDEXING_FAILURE_MESSAGE,
        indexingUpdatedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(and(eq(books.id, bookId), eq(books.userId, userId)));
  }
}
