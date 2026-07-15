import { and, desc, eq, lt } from "drizzle-orm";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { books } from "@/shared/db";
import {
  beginBookUploadInputSchema,
  beginBookUploadResponseSchema,
  booksPageResponseSchema,
} from "@/shared/contracts/books";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/server/http";
import {
  DatabaseService,
  runServerEffect,
  StorageService,
} from "@/server/services";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || 12, 1),
      50,
    );
    const cursor = url.searchParams.get("cursor");
    const cursorDate = cursor ? new Date(cursor) : null;
    if (cursor && Number.isNaN(cursorDate?.getTime()))
      throw new HttpError(400, "Invalid pagination cursor.");
    const result = await runServerEffect(
      Effect.gen(function* () {
        const { db } = yield* DatabaseService;
        const rows = yield* Effect.tryPromise(() =>
          db
            .select({
              id: books.id,
              title: books.title,
              author: books.author,
              fileSize: books.fileSize,
              pageCount: books.pageCount,
              status: books.status,
              lastPage: books.lastPage,
              progress: books.progress,
              lastOpenedAt: books.lastOpenedAt,
            })
            .from(books)
            .where(
              and(
                eq(books.userId, session.user.id),
                cursorDate ? lt(books.lastOpenedAt, cursorDate) : undefined,
              ),
            )
            .orderBy(desc(books.lastOpenedAt))
            .limit(limit + 1),
        );
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        return booksPageResponseSchema.parse({
          books: page.map((book) => ({
            id: book.id,
            title: book.title,
            author: book.author,
            fileSize: book.fileSize,
            pageCount: book.pageCount,
            status: book.status,
            lastPage: book.lastPage,
            progress: book.progress,
            lastOpenedAt: book.lastOpenedAt.toISOString(),
          })),
          nextCursor: hasMore
            ? (page.at(-1)?.lastOpenedAt.toISOString() ?? null)
            : null,
        });
      }),
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    await assertRateLimit(`upload:${session.user.id}`, 10, 60 * 60 * 1000);
    const input = beginBookUploadInputSchema.parse(await request.json());

    const result = await runServerEffect(
      Effect.gen(function* () {
        const { db } = yield* DatabaseService;
        const storage = yield* StorageService;
        const bookId = crypto.randomUUID();
        const safeName = input.fileName
          .replace(/[^a-zA-Z0-9._-]/g, "-")
          .slice(-120);
        const objectKey = `users/${session.user.id}/books/${bookId}/${safeName}`;
        const uploadUrl = yield* storage.createUploadUrl(
          objectKey,
          input.fileSize,
          input.contentType,
        );
        yield* Effect.tryPromise(() =>
          db
            .insert(books)
            .values({
              id: bookId,
              userId: session.user.id,
              title: input.title || input.fileName.replace(/\.pdf$/i, ""),
              author: input.author || null,
              objectKey,
              originalFilename: input.fileName,
              fileSize: input.fileSize,
            })
            .returning({ id: books.id }),
        );
        return { bookId, uploadUrl };
      }),
    );

    const response = beginBookUploadResponseSchema.parse({
      ...result,
      headers: { "Content-Type": "application/pdf" },
    });
    return NextResponse.json(response);
  } catch (error) {
    return apiError(error);
  }
}
