import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { books } from "@loreline/database/schema";
import {
  bookProgressInputSchema,
  bookProgressResponseSchema,
  bookResponseSchema,
  deleteBookResponseSchema,
} from "@loreline/contracts/books";
import { BookService } from "@/book-service";
import { ownedBook } from "@/book-utils";
import { apiError, requireSession } from "@/http";
import { DatabaseService, runServerEffect } from "@/services";

export async function GET(
  _: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  try {
    const session = await requireSession();
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
        lastPage: book.lastPage,
        progress: book.progress,
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  try {
    const session = await requireSession();
    const { bookId } = await context.params;
    const book = await runServerEffect(
      BookService.deleteBook(session.user.id, bookId),
    );

    return NextResponse.json(deleteBookResponseSchema.parse({ book }));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  try {
    const session = await requireSession();
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
    return NextResponse.json(bookProgressResponseSchema.parse({ book }));
  } catch (error) {
    return apiError(error);
  }
}
