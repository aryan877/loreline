import type { Folder, FolderTreeNode } from "@loreline/contracts/folders";
import type { FolderRow } from "@loreline/database/types";
import type { FolderTreeRecord } from "@/modules/folders/tree";

type FolderCounts = {
  readonly bookCount?: number;
  readonly childStackCount?: number;
  readonly descendantBookCount?: number;
  readonly descendantStackCount?: number;
};

export function serializeFolder(
  folder: FolderRow & FolderCounts,
): Folder {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    bookCount: folder.bookCount,
    childStackCount: folder.childStackCount,
    descendantBookCount: folder.descendantBookCount,
    descendantStackCount: folder.descendantStackCount,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

export function serializeFolderTree(
  folders: readonly FolderTreeRecord[],
): FolderTreeNode[] {
  return folders.map((folder) => ({
    ...serializeFolder(folder),
    children: serializeFolderTree(folder.children),
  }));
}
