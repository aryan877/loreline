import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { highlights } from "@loreline/database/schema";
import {
  createHighlightInputSchema,
  highlightResponseSchema,
  highlightsResponseSchema,
  updateHighlightInputSchema,
} from "@loreline/contracts/highlights";
import { ownedBook } from "@/book-utils";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/http";
import { DatabaseService, runServerEffect } from "@/services";

type BookContext = { params: Promise<{ bookId: string }> };
type HighlightContext = {
  params: Promise<{ bookId: string; highlightId: string }>;
};

const serializeHighlight = (highlight: typeof highlights.$inferSelect) => ({
  ...highlight,
  createdAt: highlight.createdAt.toISOString(),
});

export async function listHighlights(_: Request, context: BookContext) {
  try {
    const session = await requireSession();
    const { bookId } = await context.params;
    const result = await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(bookId, session.user.id);
        const { db } = yield* DatabaseService;
        const rows = yield* Effect.tryPromise(() =>
          db
            .select()
            .from(highlights)
            .where(
              and(
                eq(highlights.bookId, book.id),
                eq(highlights.userId, session.user.id),
              ),
            )
            .orderBy(asc(highlights.page), asc(highlights.createdAt)),
        );
        return rows;
      }),
    );
    return Response.json(
      highlightsResponseSchema.parse({
        highlights: result.map(serializeHighlight),
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function createHighlight(
  request: Request,
  context: BookContext,
) {
  try {
    const session = await requireSession();
    const { bookId } = await context.params;
    await assertRateLimit(
      `highlight:${session.user.id}`,
      180,
      60 * 60 * 1000,
    );
    const input = createHighlightInputSchema.parse(await request.json());
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
            .insert(highlights)
            .values({
              bookId: book.id,
              userId: session.user.id,
              page: input.page,
              text: input.text,
              note: input.note,
              rects: input.rects,
            })
            .returning(),
        );
        if (!created)
          return yield* Effect.fail(
            new HttpError(500, "The highlight could not be saved."),
          );
        return created;
      }),
    );
    return Response.json(
      highlightResponseSchema.parse({ highlight: serializeHighlight(result) }),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function updateHighlight(
  request: Request,
  context: HighlightContext,
) {
  try {
    const session = await requireSession();
    const { bookId, highlightId } = await context.params;
    await assertRateLimit(
      `highlight:${session.user.id}`,
      180,
      60 * 60 * 1000,
    );
    const input = updateHighlightInputSchema.parse(await request.json());
    const result = await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(bookId, session.user.id);
        const { db } = yield* DatabaseService;
        const [updated] = yield* Effect.tryPromise(() =>
          db
            .update(highlights)
            .set({ note: input.note })
            .where(
              and(
                eq(highlights.id, highlightId),
                eq(highlights.bookId, book.id),
                eq(highlights.userId, session.user.id),
              ),
            )
            .returning(),
        );
        if (!updated)
          return yield* Effect.fail(
            new HttpError(404, "Highlight not found."),
          );
        return updated;
      }),
    );
    return Response.json(
      highlightResponseSchema.parse({ highlight: serializeHighlight(result) }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function deleteHighlight(
  _: Request,
  context: HighlightContext,
) {
  try {
    const session = await requireSession();
    const { bookId, highlightId } = await context.params;
    await assertRateLimit(
      `highlight:${session.user.id}`,
      180,
      60 * 60 * 1000,
    );
    await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(bookId, session.user.id);
        const { db } = yield* DatabaseService;
        const [deleted] = yield* Effect.tryPromise(() =>
          db
            .delete(highlights)
            .where(
              and(
                eq(highlights.id, highlightId),
                eq(highlights.bookId, book.id),
                eq(highlights.userId, session.user.id),
              ),
            )
            .returning({ id: highlights.id }),
        );
        if (!deleted)
          return yield* Effect.fail(
            new HttpError(404, "Highlight not found."),
          );
      }),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
