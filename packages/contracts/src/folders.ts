import { z } from "zod";

const folderIdSchema = z.uuid();
const folderNameSchema = z.string().trim().min(1).max(180);

export const folderSchema = z.object({
  id: folderIdSchema,
  parentId: folderIdSchema.nullable(),
  name: folderNameSchema,
  bookCount: z.number().int().nonnegative().optional(),
  childStackCount: z.number().int().nonnegative().optional(),
  descendantBookCount: z.number().int().nonnegative().optional(),
  descendantStackCount: z.number().int().nonnegative().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Folder = z.infer<typeof folderSchema>;

export type FolderTreeNode = Folder & {
  children: FolderTreeNode[];
};

export const folderTreeNodeSchema: z.ZodType<FolderTreeNode> = z.lazy(() =>
  folderSchema.extend({ children: z.array(folderTreeNodeSchema) }),
);

export const getFoldersInputSchema = z.object({
  parentId: folderIdSchema.optional(),
});

export const createFolderInputSchema = z.object({
  name: folderNameSchema,
  parentId: folderIdSchema.nullable().optional(),
});

export const renameFolderInputSchema = z.object({
  name: folderNameSchema,
});

export const deleteFolderInputSchema = z.object({
  confirmation: folderNameSchema,
});

export const moveFolderInputSchema = z.object({
  parentId: folderIdSchema.nullable(),
});

export const moveBookInputSchema = z.object({
  folderId: folderIdSchema.nullable(),
});

export const folderResponseSchema = z.object({ folder: folderSchema });
export const foldersResponseSchema = z.object({
  folders: z.array(folderSchema),
});
export const folderTreeResponseSchema = z.object({
  tree: z.array(folderTreeNodeSchema),
});
export const folderBreadcrumbResponseSchema = z.object({
  breadcrumb: z.array(folderSchema),
});
export const moveBookResponseSchema = z.object({
  book: z.object({
    id: z.uuid(),
    folderId: folderIdSchema.nullable(),
  }),
});

export const deleteFolderResponseSchema = z.object({
  folder: z.object({
    id: folderIdSchema,
    deletedBookCount: z.number().int().nonnegative(),
    deletedStackCount: z.number().int().positive(),
  }),
});
