import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { books } from "@loreline/database/schema";
import { HttpError } from "@/platform/http";
import { DatabaseService } from "@/platform/services";

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

function splitLongSentence(sentence: string, maxCharacters: number) {
  const words = sentence.split(/\s+/);
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + word.length + 1 > maxCharacters) {
      parts.push(current);
      current = "";
    }
    current += `${current ? " " : ""}${word}`;
  }
  if (current) parts.push(current);
  return parts;
}

function splitSentences(text: string, maxCharacters: number) {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return [...segmenter.segment(text)].flatMap(({ segment }) => {
    const sentence = segment.trim();
    return sentence.length > maxCharacters
      ? splitLongSentence(sentence, maxCharacters)
      : [sentence];
  });
}

export function chunkPages(
  pages: string[],
  maxCharacters = 2_600,
  overlapCharacters = 260,
) {
  const chunks: Array<{ pageStart: number; pageEnd: number; content: string }> =
    [];
  pages.forEach((pageText, pageIndex) => {
    const normalized = pageText.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    const pageNumber = pageIndex + 1;
    const prefix = `[Page ${pageNumber}] `;
    const sentences = splitSentences(
      normalized,
      maxCharacters - prefix.length,
    );
    let current: string[] = [];
    let currentLength = prefix.length;

    const flush = () => {
      if (!current.length) return;
      chunks.push({
        pageStart: pageNumber,
        pageEnd: pageNumber,
        content: `${prefix}${current.join(" ")}`,
      });
      const overlap: string[] = [];
      let overlapLength = 0;
      for (let index = current.length - 1; index >= 0; index--) {
        const sentence = current[index];
        if (
          overlapLength + sentence.length + 1 > overlapCharacters
        ) {
          break;
        }
        overlap.unshift(sentence);
        overlapLength += sentence.length + 1;
      }
      current = overlap;
      currentLength = prefix.length + overlapLength;
    };

    for (const sentence of sentences) {
      if (
        current.length &&
        currentLength + sentence.length + 1 > maxCharacters
      ) {
        flush();
      }
      current.push(sentence);
      currentLength += sentence.length + 1;
    }
    flush();
  });
  return chunks.filter((chunk) => chunk.content.length > 20);
}
