import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { Effect } from "effect";
import { books } from "@loreline/database/schema";
import {
  beginBookUploadInputSchema,
  beginBookUploadResponseSchema,
  booksPageResponseSchema,
  getBooksInputSchema,
} from "@loreline/contracts/books";
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
import { FolderService } from "@/modules/folders/service";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const input = getBooksInputSchema.parse({
      folderId: url.searchParams.get("folderId"),
    });
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
              errorMessage: books.errorMessage,
              indexingStatus: books.indexingStatus,
              totalChunks: books.totalChunks,
              indexedChunks: books.indexedChunks,
              indexingError: books.indexingError,
              lastPage: books.lastPage,
              progress: books.progress,
              lastOpenedAt: books.lastOpenedAt,
            })
            .from(books)
            .where(
              and(
                eq(books.userId, session.user.id),
                input.folderId
                  ? eq(books.folderId, input.folderId)
                  : isNull(books.folderId),
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
            errorMessage: book.errorMessage,
            indexingStatus: book.indexingStatus,
            totalChunks: book.totalChunks,
            indexedChunks: book.indexedChunks,
            indexingError: book.indexingError,
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
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    await assertRateLimit(`upload:${session.user.id}`, 10, 60 * 60 * 1000);
    const input = beginBookUploadInputSchema.parse(await request.json());

    const result = await runServerEffect(
      Effect.gen(function* () {
        const { db } = yield* DatabaseService;
        const storage = yield* StorageService;
        if (input.folderId)
          yield* FolderService.getFolder(session.user.id, input.folderId);
        const bookId = crypto.randomUUID();
        const safeName = input.fileName
          .replace(/[^a-zA-Z0-9._-]/g, "-")
          .slice(-120);
        const detectedTitle = input.fileName
          .replace(/\.pdf$/i, "")
          .replace(/[+_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
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
              folderId: input.folderId ?? null,
              title: input.title || detectedTitle,
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
    return Response.json(response);
  } catch (error) {
    return apiError(error);
  }
}
