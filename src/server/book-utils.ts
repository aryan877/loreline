import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { books } from "@/shared/db";
import { DatabaseService } from "./services";
import { HttpError } from "./http";

export const ownedBook = (bookId: string, userId: string) =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const [book] = yield* Effect.tryPromise(() =>
      db
        .select()
        .from(books)
        .where(and(eq(books.id, bookId), eq(books.userId, userId)))
        .limit(1),
    );
    if (!book) return yield* Effect.fail(new HttpError(404, "Book not found."));
    return book;
  });

export function chunkPages(pages: string[], maxCharacters = 4_800) {
  const chunks: Array<{ pageStart: number; pageEnd: number; content: string }> =
    [];
  let content = "";
  let pageStart = 1;

  pages.forEach((page, index) => {
    const normalized = page.replace(/\s+/g, " ").trim();
    if (content && content.length + normalized.length > maxCharacters) {
      chunks.push({ pageStart, pageEnd: index, content });
      content = "";
      pageStart = index + 1;
    }
    content += `${content ? "\n\n" : ""}[Page ${index + 1}] ${normalized}`;
  });

  if (content) chunks.push({ pageStart, pageEnd: pages.length, content });
  return chunks.filter((chunk) => chunk.content.length > 30);
}
