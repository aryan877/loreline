import { describe, expect, it } from "vitest";
import type { FolderRow } from "@loreline/database/types";
import {
  buildFolderBreadcrumb,
  buildFolderTree,
} from "@/modules/folders/tree";

const timestamp = new Date("2026-07-19T00:00:00.000Z");

function folder(
  id: string,
  name: string,
  parentId: string | null,
): FolderRow {
  return {
    id,
    userId: "user-1",
    parentId,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("folder hierarchy", () => {
  const rows = [
    folder("work", "Work", null),
    folder("history", "History", "work"),
    folder("archives", "Archives", "history"),
  ];

  it("builds arbitrarily nested stacks", () => {
    const tree = buildFolderTree(rows);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe("Work");
    expect(tree[0]?.children[0]?.name).toBe("History");
    expect(tree[0]?.children[0]?.children[0]?.name).toBe("Archives");
  });

  it("builds the complete path to a nested stack", () => {
    expect(
      buildFolderBreadcrumb(rows, "archives").map(({ name }) => name),
    ).toEqual(["Work", "History", "Archives"]);
  });
});
