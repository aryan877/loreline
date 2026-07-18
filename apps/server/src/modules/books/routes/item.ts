import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { books } from "@loreline/database/schema";
import {
  bookProgressInputSchema,
  bookProgressResponseSchema,
  bookResponseSchema,
} from "@loreline/contracts/books";
import { ownedBook } from "@/modules/books/text";
import { apiError, requireSession } from "@/platform/http";
import { DatabaseService, runServerEffect } from "@/platform/services";

export async function GET(
  request: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  try {
    const session = await requireSession(request);
    const { bookId } = await context.params;
    const book = await runServerEffect(ownedBook(bookId, session.user.id));
    const response = bookResponseSchema.parse({
      book: {
        id: book.id,
        title: book.title,
        author: book.author,
        originalFilename: book.originalFilename,
        fileSize: book.fileSize,
        pageCount: book.pageCount,
        status: book.status,
        errorMessage: book.errorMessage,
        indexingStatus: book.indexingStatus,
        totalChunks: book.totalChunks,
        indexedChunks: book.indexedChunks,
        indexingError: book.indexingError,
        lastPage: book.lastPage,
        progress: book.progress,
      },
    });
    return Response.json(response);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  try {
    const session = await requireSession(request);
    const { bookId } = await context.params;
    const input = bookProgressInputSchema.parse(await request.json());
    const book = await runServerEffect(
      Effect.gen(function* () {
        const existing = yield* ownedBook(bookId, session.user.id);
        const { db } = yield* DatabaseService;
        const [updated] = yield* Effect.tryPromise(() =>
          db
            .update(books)
            .set({
              lastPage: Math.min(input.page, existing.pageCount),
              progress: input.progress,
              lastOpenedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(books.id, existing.id))
            .returning({ lastPage: books.lastPage, progress: books.progress }),
        );
        return updated;
      }),
    );
    return Response.json(bookProgressResponseSchema.parse({ book }));
  } catch (error) {
    return apiError(error);
  }
}
