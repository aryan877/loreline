import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { books } from "@loreline/database/schema";
import { retryBookIndexResponseSchema } from "@loreline/contracts/books";
import { enqueueBookIndex } from "@/modules/books/index-queue";
import { ownedBook } from "@/modules/books/text";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/platform/http";
import { DatabaseService, runServerEffect } from "@/platform/services";

export async function POST(
  request: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  try {
    const session = await requireSession(request);
    const { bookId } = await context.params;
    await assertRateLimit(
      `book-index:${session.user.id}`,
      20,
      60 * 60 * 1_000,
    );
    const book = await runServerEffect(
      Effect.gen(function* () {
        const existing = yield* ownedBook(bookId, session.user.id);
        if (existing.status !== "ready") {
          return yield* Effect.fail(
            new HttpError(409, "The PDF must finish preparing first."),
          );
        }
        if (existing.totalChunks === 0) {
          return yield* Effect.fail(
            new HttpError(
              422,
              existing.indexingError ??
                "This PDF does not contain searchable text.",
            ),
          );
        }
        if (
          existing.indexingStatus === "ready" ||
          existing.indexingStatus === "indexing"
        ) {
          return existing;
        }
        const { db } = yield* DatabaseService;
        const [pending] = yield* Effect.tryPromise(() =>
          db
            .update(books)
            .set({
              indexingStatus: "pending",
              indexingError: null,
              indexingUpdatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(eq(books.id, bookId), eq(books.userId, session.user.id)),
            )
            .returning(),
        );
        return pending;
      }),
    );
    if (book.indexingStatus !== "ready") {
      try {
        await enqueueBookIndex({
          bookId: book.id,
          userId: session.user.id,
        });
      } catch (error) {
        console.error("Loreline could not enqueue book indexing", {
          bookId: book.id,
          error,
        });
        throw new HttpError(
          503,
          "Search indexing is temporarily unavailable. Please try again.",
        );
      }
    }
    return Response.json(
      retryBookIndexResponseSchema.parse({ book }),
      { status: book.indexingStatus === "ready" ? 200 : 202 },
    );
  } catch (error) {
    return apiError(error);
  }
}
