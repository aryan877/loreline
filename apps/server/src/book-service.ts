import "server-only";

import { Effect } from "effect";
import { BookRepository } from "@/book-repository";
import { StorageService } from "@/services";

export const BookService = {
  deleteBook: (userId: string, bookId: string) =>
    Effect.gen(function* () {
      const book = yield* BookRepository.getBook(userId, bookId);
      const storage = yield* StorageService;

      yield* storage.delete(book.objectKey);

      return yield* BookRepository.deleteBook(userId, book.id);
    }),
};
