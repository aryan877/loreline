import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { books } from "@loreline/database/schema";
import { ownedBook } from "@/modules/books/text";
import { HttpError } from "@/platform/http";
import { DatabaseService, StorageService } from "@/platform/services";

export const BookService = {
  deleteBook: (userId: string, bookId: string) =>
    Effect.gen(function* () {
      const book = yield* ownedBook(bookId, userId);
      const storage = yield* StorageService;
      const { db } = yield* DatabaseService;

      const prefix = `users/${userId}/books/${book.id}/`;
      yield* storage.deletePrefix(prefix);

      const [deleted] = yield* Effect.tryPromise(() =>
        db
          .delete(books)
          .where(and(eq(books.id, book.id), eq(books.userId, userId)))
          .returning({ id: books.id }),
      );
      if (!deleted)
        return yield* Effect.fail(new HttpError(404, "Book not found."));
      yield* storage.deletePrefix(prefix).pipe(
        Effect.catchAll((error) =>
          Effect.logError("Post-delete R2 cleanup pass failed", error),
        ),
      );
      return deleted;
    }),
};
