import { Effect } from "effect";
import { FolderRepository } from "@/modules/folders/repository";
import { HttpError } from "@/platform/http";
import { StorageService } from "@/platform/services";

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

type DeleteFolderInput = {
  readonly folderId: string;
  readonly confirmation: string;
};

function hasDuplicateSibling(
  folders: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  name: string,
  excludedId?: string,
) {
  return folders.some(
    (folder) => folder.id !== excludedId && folder.name === name,
  );
}

export const FolderService = {
  getFolder: FolderRepository.getFolder,
  getFolders: FolderRepository.getFolders,
  folderTree: FolderRepository.folderTree,
  folderBreadcrumb: FolderRepository.folderBreadcrumb,

  getFolderSummary: (userId: string, folderId: string) =>
    Effect.gen(function* () {
      const folder = yield* FolderRepository.getFolder(userId, folderId);
      const summary = yield* FolderRepository.getSubtreeSummary(
        userId,
        folderId,
      );
      return {
        ...folder,
        descendantBookCount: summary.descendant_book_count,
        descendantStackCount: summary.descendant_stack_count,
      };
    }),

  createFolder: (userId: string, input: CreateFolderInput) =>
    Effect.gen(function* () {
      const parentId = input.parentId ?? null;
      if (parentId) yield* FolderRepository.getFolder(userId, parentId);
      const siblings = yield* FolderRepository.getFolders(userId, parentId);
      if (hasDuplicateSibling(siblings, input.name))
        return yield* Effect.fail(
          new HttpError(409, "A stack with this name already exists here."),
        );
      return yield* FolderRepository.createFolder(userId, {
        name: input.name,
        parentId,
      });
    }),

  renameFolder: (userId: string, input: RenameFolderInput) =>
    Effect.gen(function* () {
      const folder = yield* FolderRepository.getFolder(userId, input.folderId);
      const siblings = yield* FolderRepository.getFolders(
        userId,
        folder.parentId,
      );
      if (hasDuplicateSibling(siblings, input.name, folder.id))
        return yield* Effect.fail(
          new HttpError(409, "A stack with this name already exists here."),
        );
      return yield* FolderRepository.renameFolder(userId, input);
    }),

  deleteFolder: (userId: string, input: DeleteFolderInput) =>
    Effect.gen(function* () {
      const folder = yield* FolderRepository.getFolder(userId, input.folderId);
      if (input.confirmation !== folder.name)
        return yield* Effect.fail(
          new HttpError(400, "Type the exact stack name to confirm deletion."),
        );
      const summary = yield* FolderRepository.getSubtreeSummary(
        userId,
        input.folderId,
      );
      const bookIds = summary.book_ids;
      const storage = yield* StorageService;
      const deleteAssets = (bookId: string) =>
        storage.deletePrefix(`users/${userId}/books/${bookId}/`);

      yield* Effect.forEach(bookIds, deleteAssets, {
        concurrency: 4,
        discard: true,
      });
      yield* FolderRepository.deleteFolder(userId, input.folderId);
      yield* Effect.forEach(bookIds, deleteAssets, {
        concurrency: 4,
        discard: true,
      }).pipe(
        Effect.catchAll((error) =>
          Effect.logError("Post-delete R2 cleanup pass failed", error),
        ),
      );

      return {
        id: folder.id,
        deletedBookCount: bookIds.length,
        deletedStackCount: summary.descendant_stack_count + 1,
      };
    }),

  moveFolder: (userId: string, input: MoveFolderInput) =>
    Effect.gen(function* () {
      if (input.parentId === input.folderId)
        return yield* Effect.fail(
          new HttpError(400, "A stack cannot contain itself."),
        );
      yield* FolderRepository.getFolder(userId, input.folderId);
      if (input.parentId) {
        const destination = yield* FolderRepository.folderBreadcrumb(
          userId,
          input.parentId,
        );
        if (destination.some((folder) => folder.id === input.folderId))
          return yield* Effect.fail(
            new HttpError(400, "A stack cannot move inside its descendant."),
          );
      }
      return yield* FolderRepository.moveFolder(userId, input);
    }),

  moveBook: (userId: string, input: MoveBookInput) =>
    Effect.gen(function* () {
      if (input.folderId)
        yield* FolderRepository.getFolder(userId, input.folderId);
      return yield* FolderRepository.moveBook(userId, input);
    }),
};
