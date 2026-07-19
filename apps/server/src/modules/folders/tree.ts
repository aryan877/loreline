import type { FolderRow } from "@loreline/database/types";

export type FolderTreeRecord = FolderRow & {
  readonly children: FolderTreeRecord[];
};

export function buildFolderTree(rows: readonly FolderRow[]) {
  const nodes = new Map<string, FolderTreeRecord>();
  const roots: FolderTreeRecord[] = [];

  for (const row of rows) nodes.set(row.id, { ...row, children: [] });

  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

export function buildFolderBreadcrumb(
  rows: readonly FolderRow[],
  folderId: string,
) {
  const byId = new Map(rows.map((folder) => [folder.id, folder]));
  const trail: FolderRow[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    trail.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return trail.reverse();
}
