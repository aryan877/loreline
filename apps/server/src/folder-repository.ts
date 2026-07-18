import "server-only";

import { and, asc, eq, isNull, sql, type InferSelectModel } from "drizzle-orm";
import { Effect } from "effect";
import { books, folders } from "@loreline/database/schema";
import { HttpError } from "@/http";
import { DatabaseService } from "@/services";

type FolderRow = InferSelectModel<typeof folders>;

export type FolderTreeNode = FolderRow & {
  children: FolderTreeNode[];
};

type CreateFolderInput = {
  readonly name: string;
  readonly parentId?: string | null;
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

function buildFolderTree(rows: FolderRow[]) {
  const nodes = new Map<string, FolderTreeNode>();
  const roots: FolderTreeNode[] = [];

  for (const row of rows) nodes.set(row.id, { ...row, children: [] });

  for (const node of nodes.values()) {
    if (!node.parentId) {
      roots.push(node);
      continue;
    }

    const parent = nodes.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

function buildFolderBreadcrumb(rows: FolderRow[], folderId: string) {
  const byId = new Map(rows.map((folder) => [folder.id, folder]));
  const trail: FolderRow[] = [];
  let current = byId.get(folderId);

  while (current) {
    trail.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return trail.reverse();
}

export const FolderRepository = {
  createFolder: (userId: string, input: CreateFolderInput) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const parentId = input.parentId ?? null;

      if (parentId) yield* FolderRepository.getFolder(userId, parentId);

      const [folder] = yield* Effect.tryPromise(() =>
        db
          .insert(folders)
          .values({
            userId,
            parentId,
            name: input.name,
          })
          .returning(),
      );

      return folder;
    }),

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
        return yield* Effect.fail(new HttpError(404, "Folder not found."));

      return folder;
    }),

  getFolders: (userId: string, parentId: string | null = null) =>
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
              select count(*)::int
              from "books"
              where "books"."folder_id" = ${folders.id}
                and "books"."user_id" = ${userId}
            )`,
            childStackCount: sql<number>`(
              select count(*)::int
              from "folders" as child_folders
              where child_folders."parent_id" = ${folders.id}
                and child_folders."user_id" = ${userId}
            )`,
          })
          .from(folders)
          .where(
            and(
              eq(folders.userId, userId),
              parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId),
            ),
          )
          .orderBy(asc(folders.name), asc(folders.createdAt)),
      );
    }),

  getBooksInFolder: (userId: string, folderId: string) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;

      return yield* Effect.tryPromise(() =>
        db
          .select()
          .from(books)
          .where(and(eq(books.folderId, folderId), eq(books.userId, userId))),
      );
    }),

  renameFolder: (userId: string, input: RenameFolderInput) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const [folder] = yield* Effect.tryPromise(() =>
        db
          .update(folders)
          .set({ name: input.name, updatedAt: new Date() })
          .where(and(eq(folders.id, input.folderId), eq(folders.userId, userId)))
          .returning(),
      );

      if (!folder)
        return yield* Effect.fail(new HttpError(404, "Folder not found."));

      return folder;
    }),

  deleteFolder: (userId: string, folderId: string) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const [folder] = yield* Effect.tryPromise(() =>
        db
          .delete(folders)
          .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
          .returning(),
      );

      if (!folder)
        return yield* Effect.fail(new HttpError(404, "Folder not found."));

      return folder;
    }),

  moveFolder: (userId: string, input: MoveFolderInput) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      if (input.parentId) yield* FolderRepository.getFolder(userId, input.parentId);

      const [folder] = yield* Effect.tryPromise(() =>
        db
          .update(folders)
          .set({ parentId: input.parentId, updatedAt: new Date() })
          .where(and(eq(folders.id, input.folderId), eq(folders.userId, userId)))
          .returning(),
      );

      if (!folder)
        return yield* Effect.fail(new HttpError(404, "Folder not found."));

      return folder;
    }),

  moveBook: (userId: string, input: MoveBookInput) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;

      if (input.folderId) yield* FolderRepository.getFolder(userId, input.folderId);

      const [book] = yield* Effect.tryPromise(() =>
        db
          .update(books)
          .set({ folderId: input.folderId, updatedAt: new Date() })
          .where(and(eq(books.id, input.bookId), eq(books.userId, userId)))
          .returning(),
      );

      if (!book)
        return yield* Effect.fail(new HttpError(404, "Book not found."));

      return book;
    }),

  folderTree: (userId: string) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const rows = yield* Effect.tryPromise(() =>
        db
          .select()
          .from(folders)
          .where(eq(folders.userId, userId))
          .orderBy(asc(folders.name), asc(folders.createdAt)),
      );

      return buildFolderTree(rows);
    }),

  folderBreadcrumb: (userId: string, folderId: string) =>
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      const rows = yield* Effect.tryPromise(() =>
        db
          .select()
          .from(folders)
          .where(eq(folders.userId, userId))
          .orderBy(asc(folders.name), asc(folders.createdAt)),
      );
      const breadcrumb = buildFolderBreadcrumb(rows, folderId);

      if (breadcrumb.length === 0)
        return yield* Effect.fail(new HttpError(404, "Folder not found."));

      return breadcrumb;
    }),
};
