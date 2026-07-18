import "server-only";

import { Effect } from "effect";
import { FolderRepository } from "@/folder-repository";
import { HttpError } from "@/http";

export type CreateFolderInput = {
  readonly name: string;
  readonly parentId?: string | null;
};

export type RenameFolderInput = {
  readonly folderId: string;
  readonly name: string;
};

export type MoveFolderInput = {
  readonly folderId: string;
  readonly parentId: string | null;
};

export type MoveBookInput = {
  readonly bookId: string;
  readonly folderId: string | null;
};

function hasDuplicateSibling(
  folders: ReadonlyArray<{ id: string; name: string }>,
  name: string,
  excludedId?: string,
) {
  return folders.some(
    (folder) => folder.id !== excludedId && folder.name === name,
  );
}

export const FolderService = {
  createFolder: (userId: string, input: CreateFolderInput) =>
    Effect.gen(function* () {
      const siblings = yield* FolderRepository.getFolders(
        userId,
        input.parentId ?? null,
      );

      if (hasDuplicateSibling(siblings, input.name))
        return yield* Effect.fail(
          new HttpError(409, "A folder with this name already exists here."),
        );

      return yield* FolderRepository.createFolder(userId, input);
    }),

  getFolder: FolderRepository.getFolder,

  getFolders: FolderRepository.getFolders,

  renameFolder: (userId: string, input: RenameFolderInput) =>
    Effect.gen(function* () {
      const folder = yield* FolderRepository.getFolder(userId, input.folderId);
      const siblings = yield* FolderRepository.getFolders(
        userId,
        folder.parentId,
      );

      if (hasDuplicateSibling(siblings, input.name, folder.id))
        return yield* Effect.fail(
          new HttpError(409, "A folder with this name already exists here."),
        );

      return yield* FolderRepository.renameFolder(userId, input);
    }),

  deleteFolder: (userId: string, folderId: string) =>
    Effect.gen(function* () {
      yield* FolderRepository.getFolder(userId, folderId);

      const [children, books] = yield* Effect.all([
        FolderRepository.getFolders(userId, folderId),
        FolderRepository.getBooksInFolder(userId, folderId),
      ]);

      if (children.length > 0)
        return yield* Effect.fail(
          new HttpError(
            409,
            "This folder contains child folders. Move or delete them first.",
          ),
        );

      if (books.length > 0)
        return yield* Effect.fail(
          new HttpError(
            409,
            "This folder contains books. Move them before deleting the folder.",
          ),
        );

      return yield* FolderRepository.deleteFolder(userId, folderId);
    }),

  moveFolder: (userId: string, input: MoveFolderInput) =>
    Effect.gen(function* () {
      if (input.parentId === input.folderId)
        return yield* Effect.fail(
          new HttpError(400, "A folder cannot contain itself."),
        );

      yield* FolderRepository.getFolder(userId, input.folderId);

      if (input.parentId) {
        const breadcrumb = yield* FolderRepository.folderBreadcrumb(
          userId,
          input.parentId,
        );

        if (breadcrumb.some((folder) => folder.id === input.folderId))
          return yield* Effect.fail(
            new HttpError(400, "A folder cannot move into its descendant."),
          );
      }

      return yield* FolderRepository.moveFolder(userId, input);
    }),

  moveBook: FolderRepository.moveBook,

  folderTree: FolderRepository.folderTree,

  folderBreadcrumb: FolderRepository.folderBreadcrumb,
};
