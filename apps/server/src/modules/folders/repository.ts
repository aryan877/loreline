import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import { books, folders } from "@loreline/database/schema";
import { HttpError } from "@/platform/http";
import { DatabaseService } from "@/platform/services";
import { buildFolderBreadcrumb, buildFolderTree } from "@/modules/folders/tree";

type CreateFolderInput = {
  readonly name: string;
  readonly parentId: string | null;
};

type RenameFolderInput = {
  readonly folderId: string;
  readonly name: string;
};

type MoveFolderInput = {
  readonly folderId: string;
  readonly parentId: string | null;
};

type MoveBookInput = {
  readonly bookId: string;
  readonly folderId: string | null;
};

export const FolderRepository = {
  getFolder: (userId: string, folderId: string) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const [folder] = yield* Effect.tryPromise(() =>
        db
          .select()
          .from(folders)
          .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
          .limit(1),
      );
      if (!folder)
        return yield* Effect.fail(new HttpError(404, "Stack not found."));
      return folder;
    }),

  getFolders: (userId: string, parentId: string | null) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      return yield* Effect.tryPromise(() =>
        db
          .select({
            id: folders.id,
            userId: folders.userId,
            parentId: folders.parentId,
            name: folders.name,
            createdAt: folders.createdAt,
            updatedAt: folders.updatedAt,
            bookCount: sql<number>`(
              select count(*)::int from ${books}
              where ${books.folderId} = ${folders.id}
                and ${books.userId} = ${userId}
            )`,
            childStackCount: sql<number>`(
              select count(*)::int from ${folders} as child
              where child.parent_id = ${folders.id}
                and child.user_id = ${userId}
            )`,
          })
          .from(folders)
          .where(
            and(
              eq(folders.userId, userId),
              parentId
                ? eq(folders.parentId, parentId)
                : isNull(folders.parentId),
            ),
          )
          .orderBy(asc(folders.name), asc(folders.createdAt)),
      );
    }),

  getSubtreeSummary: (userId: string, folderId: string) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const result = yield* Effect.tryPromise(() =>
        db.execute<{
          book_ids: string[];
          descendant_book_count: number;
          descendant_stack_count: number;
        }>(sql`
          with recursive subtree as (
            select id from ${folders}
            where ${folders.id} = ${folderId}
              and ${folders.userId} = ${userId}
            union all
            select child.id
            from ${folders} child
            join subtree parent on child.parent_id = parent.id
            where child.user_id = ${userId}
          )
          select
            (select greatest(count(*) - 1, 0)::int from subtree)
              as descendant_stack_count,
            (select count(*)::int from ${books}
              where ${books.userId} = ${userId}
                and ${books.folderId} in (select id from subtree))
              as descendant_book_count,
            coalesce((select array_agg(${books.id}) from ${books}
              where ${books.userId} = ${userId}
                and ${books.folderId} in (select id from subtree)),
              array[]::uuid[]) as book_ids
        `),
      );
      return (
        result.rows[0] ?? {
          book_ids: [],
          descendant_book_count: 0,
          descendant_stack_count: 0,
        }
      );
    }),

  getAllFolders: (userId: string) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      return yield* Effect.tryPromise(() =>
        db
          .select()
          .from(folders)
          .where(eq(folders.userId, userId))
          .orderBy(asc(folders.name), asc(folders.createdAt)),
      );
    }),

  createFolder: (userId: string, input: CreateFolderInput) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const [folder] = yield* Effect.tryPromise(() =>
        db
          .insert(folders)
          .values({ userId, parentId: input.parentId, name: input.name })
          .returning(),
      );
      if (!folder)
        return yield* Effect.fail(
          new HttpError(500, "The stack could not be created."),
        );
      return folder;
    }),

  renameFolder: (userId: string, input: RenameFolderInput) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const [folder] = yield* Effect.tryPromise(() =>
        db
          .update(folders)
          .set({ name: input.name, updatedAt: new Date() })
          .where(
            and(eq(folders.id, input.folderId), eq(folders.userId, userId)),
          )
          .returning(),
      );
      if (!folder)
        return yield* Effect.fail(new HttpError(404, "Stack not found."));
      return folder;
    }),

  deleteFolder: (userId: string, folderId: string) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const [folder] = yield* Effect.tryPromise(() =>
        db
          .delete(folders)
          .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
          .returning({ id: folders.id }),
      );
      if (!folder)
        return yield* Effect.fail(new HttpError(404, "Stack not found."));
      return folder;
    }),

  moveFolder: (userId: string, input: MoveFolderInput) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const [folder] = yield* Effect.tryPromise(() =>
        db
          .update(folders)
          .set({ parentId: input.parentId, updatedAt: new Date() })
          .where(
            and(eq(folders.id, input.folderId), eq(folders.userId, userId)),
          )
          .returning(),
      );
      if (!folder)
        return yield* Effect.fail(new HttpError(404, "Stack not found."));
      return folder;
    }),

  moveBook: (userId: string, input: MoveBookInput) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const [book] = yield* Effect.tryPromise(() =>
        db
          .update(books)
          .set({ folderId: input.folderId, updatedAt: new Date() })
          .where(and(eq(books.id, input.bookId), eq(books.userId, userId)))
          .returning({ id: books.id, folderId: books.folderId }),
      );
      if (!book)
        return yield* Effect.fail(new HttpError(404, "Book not found."));
      return book;
    }),

  folderTree: (userId: string) =>
    FolderRepository.getAllFolders(userId).pipe(Effect.map(buildFolderTree)),

  folderBreadcrumb: (userId: string, folderId: string) =>
    FolderRepository.getAllFolders(userId).pipe(
      Effect.map((rows) => buildFolderBreadcrumb(rows, folderId)),
      Effect.filterOrFail(
        (breadcrumb) => breadcrumb.length > 0,
        () => new HttpError(404, "Stack not found."),
      ),
    ),
};
