import type { Folder, FolderTreeNode } from "@loreline/contracts/folders";

type FolderRecord = Omit<Folder, "createdAt" | "updatedAt"> & {
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type FolderTreeRecord = FolderRecord & {
  readonly children: FolderTreeRecord[];
};

export function serializeFolder(folder: FolderRecord): Folder {
  return {
    ...folder,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

export function serializeFolderTree(
  folders: FolderTreeRecord[],
): FolderTreeNode[] {
  return folders.map((folder) => ({
    ...serializeFolder(folder),
    children: serializeFolderTree(folder.children),
  }));
}
