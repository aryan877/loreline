import "server-only";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { books } from "@loreline/database/schema";
import { HttpError } from "@/http";
import { DatabaseService } from "@/services";

export const BookRepository = {
  getBook: (userId: string, bookId: string) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const [book] = yield* Effect.tryPromise(() =>
        db
          .select()
          .from(books)
          .where(and(eq(books.id, bookId), eq(books.userId, userId)))
          .limit(1),
      );

      if (!book)
        return yield* Effect.fail(new HttpError(404, "Book not found."));

      return book;
    }),

  deleteBook: (userId: string, bookId: string) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const [book] = yield* Effect.tryPromise(() =>
        db
          .delete(books)
          .where(and(eq(books.id, bookId), eq(books.userId, userId)))
          .returning({ id: books.id }),
      );

      if (!book)
        return yield* Effect.fail(new HttpError(404, "Book not found."));

      return book;
    }),
};
