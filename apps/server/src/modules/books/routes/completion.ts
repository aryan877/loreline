import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { extractText, getDocumentProxy } from "unpdf";
import { bookChunks, books } from "@loreline/database/schema";
import { uploadBookResponseSchema } from "@loreline/contracts/books";
import { enqueueBookIndex } from "@/modules/books/index-queue";
import { chunkPages, ownedBook } from "@/modules/books/text";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/platform/http";
import {
  DatabaseService,
  runServerEffect,
  StorageService,
} from "@/platform/services";

export async function POST(
  request: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  let failedBook: { bookId: string; userId: string } | undefined;
  try {
    const session = await requireSession(request);
    const { bookId } = await context.params;
    failedBook = { bookId, userId: session.user.id };
    await assertRateLimit(
      `upload-complete:${session.user.id}`,
      10,
      60 * 60 * 1000,
    );
    const result = await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(bookId, session.user.id);
        if (book.status === "ready") return book;
        const { db } = yield* DatabaseService;
        const storage = yield* StorageService;
        const bytes = yield* storage.get(book.objectKey);
        if (bytes.byteLength !== book.fileSize)
          return yield* Effect.fail(
            new HttpError(
              422,
              "The uploaded PDF was incomplete. Please try again.",
            ),
          );
        const signature = new TextDecoder().decode(bytes.slice(0, 5));
        if (signature !== "%PDF-")
          return yield* Effect.fail(
            new HttpError(415, "This file is not a valid PDF."),
          );

        const parsed = yield* Effect.tryPromise({
          try: async () => {
            const pdf = await getDocumentProxy(bytes);
            return extractText(pdf, { mergePages: false });
          },
          catch: () =>
            new HttpError(
              422,
              "Loreline couldn’t read this PDF. Try a standard, unlocked PDF.",
            ),
        });
        const chunks = chunkPages(parsed.text);
        const indexingError = chunks.length
          ? null
          : "This PDF has no searchable text. It may be a scanned document.";
        const [ready] = yield* Effect.tryPromise(() =>
          db.transaction(async (transaction) => {
            await transaction
              .delete(bookChunks)
              .where(
                and(
                  eq(bookChunks.bookId, book.id),
                  eq(bookChunks.userId, session.user.id),
                ),
              );
            if (chunks.length) {
              await transaction.insert(bookChunks).values(
                chunks.map((chunk) => ({
                  bookId: book.id,
                  userId: session.user.id,
                  ...chunk,
                })),
              );
            }
            return transaction
              .update(books)
              .set({
                pageCount: parsed.totalPages,
                status: "ready",
                indexingStatus: chunks.length ? "pending" : "failed",
                totalChunks: chunks.length,
                indexedChunks: 0,
                indexingError,
                indexingUpdatedAt: new Date(),
                errorMessage: null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(books.id, book.id),
                  eq(books.userId, session.user.id),
                ),
              )
              .returning();
          }),
        );
        return ready;
      }),
    );
    if (result.indexingStatus !== "ready" && result.totalChunks > 0) {
      try {
        await enqueueBookIndex({
          bookId: result.id,
          userId: session.user.id,
        });
      } catch (error) {
        console.error("Loreline could not enqueue book indexing", {
          bookId: result.id,
          error,
        });
      }
    }
    return Response.json(
      uploadBookResponseSchema.parse({
        book: { ...result, createdAt: result.createdAt.toISOString() },
      }),
    );
  } catch (error) {
    if (
      failedBook &&
      error instanceof HttpError &&
      (error.status === 415 || error.status === 422)
    ) {
      const { bookId, userId } = failedBook;
      try {
        await runServerEffect(
          Effect.gen(function* () {
            const { db } = yield* DatabaseService;
            yield* Effect.tryPromise(() =>
              db
                .update(books)
                .set({
                  status: "failed",
                  errorMessage: error.message,
                  indexingStatus: "failed",
                  indexingError: "Search indexing waits for a readable PDF.",
                  indexingUpdatedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(books.id, bookId),
                    eq(books.userId, userId),
                  ),
                ),
            );
          }),
        );
      } catch (updateError) {
        console.error("Loreline could not persist PDF preparation failure", {
          bookId,
          updateError,
        });
      }
    }
    return apiError(error);
  }
}
