import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { bookChunks, books } from "@loreline/database/schema";
import { uploadBookResponseSchema } from "@loreline/contracts/books";
import { chunkPages, ownedBook } from "@/book-utils";
import { apiError, assertRateLimit, HttpError, requireSession } from "@/http";
import { DatabaseService, runServerEffect, StorageService } from "@/services";
import { AppConfigTag } from "@/config";
import { createOpenRouterEmbeddings } from "@/openrouter-client";

export const runtime = "nodejs";

export async function POST(
  _: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  try {
    const session = await requireSession();
    const { bookId } = await context.params;
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
        const config = yield* AppConfigTag;
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
        let embeddings: number[][] = [];
        if (config.openRouterApiKey && chunks.length) {
          const embedded = yield* Effect.tryPromise(() =>
            createOpenRouterEmbeddings(
              chunks.map((chunk) => chunk.content),
              {
                apiKey: config.openRouterApiKey!,
                model: config.openRouterEmbeddingModel,
              },
            ),
          );
          embeddings = embedded;
        }

        yield* Effect.tryPromise(() =>
          db
            .delete(bookChunks)
            .where(
              and(
                eq(bookChunks.bookId, book.id),
                eq(bookChunks.userId, session.user.id),
              ),
            ),
        );
        if (chunks.length) {
          yield* Effect.tryPromise(() =>
            db.insert(bookChunks).values(
              chunks.map((chunk, index) => ({
                bookId: book.id,
                userId: session.user.id,
                ...chunk,
                embedding: embeddings[index],
              })),
            ),
          );
        }
        const [ready] = yield* Effect.tryPromise(() =>
          db
            .update(books)
            .set({
              pageCount: parsed.totalPages,
              status: "ready",
              errorMessage: null,
              updatedAt: new Date(),
            })
            .where(
              and(eq(books.id, book.id), eq(books.userId, session.user.id)),
            )
            .returning(),
        );
        return ready;
      }),
    );
    return NextResponse.json(
      uploadBookResponseSchema.parse({
        book: { ...result, createdAt: result.createdAt.toISOString() },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
