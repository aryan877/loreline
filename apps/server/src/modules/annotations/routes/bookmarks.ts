import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { bookmarks } from "@loreline/database/schema";
import {
  bookmarkResponseSchema,
  bookmarksResponseSchema,
  createBookmarkInputSchema,
} from "@loreline/contracts/bookmarks";
import { ownedBook } from "@/modules/books/text";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/platform/http";
import { DatabaseService, runServerEffect } from "@/platform/services";

type BookContext = { params: Promise<{ bookId: string }> };
type BookmarkContext = {
  params: Promise<{ bookId: string; bookmarkId: string }>;
};

const serializeBookmark = (bookmark: typeof bookmarks.$inferSelect) => ({
  id: bookmark.id,
  bookId: bookmark.bookId,
  page: bookmark.page,
  createdAt: bookmark.createdAt.toISOString(),
});

export async function listBookmarks(request: Request, context: BookContext) {
  try {
    const session = await requireSession(request);
    const { bookId } = await context.params;
    const result = await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(bookId, session.user.id);
        const { db } = yield* DatabaseService;
        return yield* Effect.tryPromise(() =>
          db
            .select()
            .from(bookmarks)
            .where(
              and(
                eq(bookmarks.bookId, book.id),
                eq(bookmarks.userId, session.user.id),
              ),
            )
            .orderBy(asc(bookmarks.page)),
        );
      }),
    );
    return Response.json(
      bookmarksResponseSchema.parse({
        bookmarks: result.map(serializeBookmark),
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function createBookmark(request: Request, context: BookContext) {
  try {
    const session = await requireSession(request);
    const { bookId } = await context.params;
    await assertRateLimit(`bookmark:${session.user.id}`, 120, 60 * 60 * 1000);
    const input = createBookmarkInputSchema.parse(await request.json());
    const result = await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(bookId, session.user.id);
        if (input.page > book.pageCount)
          return yield* Effect.fail(
            new HttpError(400, "That page is outside this book."),
          );
        const { db } = yield* DatabaseService;
        const [created] = yield* Effect.tryPromise(() =>
          db
            .insert(bookmarks)
            .values({
              bookId: book.id,
              userId: session.user.id,
              page: input.page,
            })
            .onConflictDoNothing()
            .returning(),
        );
        if (created) return created;
        const [existing] = yield* Effect.tryPromise(() =>
          db
            .select()
            .from(bookmarks)
            .where(
              and(
                eq(bookmarks.bookId, book.id),
                eq(bookmarks.userId, session.user.id),
                eq(bookmarks.page, input.page),
              ),
            )
            .limit(1),
        );
        if (!existing)
          return yield* Effect.fail(
            new HttpError(500, "The bookmark could not be saved."),
          );
        return existing;
      }),
    );
    return Response.json(
      bookmarkResponseSchema.parse({ bookmark: serializeBookmark(result) }),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function deleteBookmark(
  request: Request,
  context: BookmarkContext,
) {
  try {
    const session = await requireSession(request);
    const { bookId, bookmarkId } = await context.params;
    await assertRateLimit(`bookmark:${session.user.id}`, 120, 60 * 60 * 1000);
    await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(bookId, session.user.id);
        const { db } = yield* DatabaseService;
        const [deleted] = yield* Effect.tryPromise(() =>
          db
            .delete(bookmarks)
            .where(
              and(
                eq(bookmarks.id, bookmarkId),
                eq(bookmarks.bookId, book.id),
                eq(bookmarks.userId, session.user.id),
              ),
            )
            .returning({ id: bookmarks.id }),
        );
        if (!deleted)
          return yield* Effect.fail(new HttpError(404, "Bookmark not found."));
      }),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
