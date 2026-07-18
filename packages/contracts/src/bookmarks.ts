import { z } from "zod";

export const bookmarkSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  page: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type Bookmark = z.infer<typeof bookmarkSchema>;

export const bookmarksResponseSchema = z.object({
  bookmarks: z.array(bookmarkSchema),
});
export type BookmarksResponse = z.infer<typeof bookmarksResponseSchema>;

export const createBookmarkInputSchema = z.object({
  page: z.number().int().positive(),
});
export type CreateBookmarkInput = z.infer<typeof createBookmarkInputSchema>;

export const bookmarkResponseSchema = z.object({
  bookmark: bookmarkSchema,
});
export type BookmarkResponse = z.infer<typeof bookmarkResponseSchema>;
