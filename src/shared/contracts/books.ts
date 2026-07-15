import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { books } from "../db/schema";

const bookSelectSchema = createSelectSchema(books);

export const MAX_BOOK_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_BOOK_FILE_SIZE_LABEL = "50 MB";

export const beginBookUploadInputSchema = z.object({
  fileName: z.string().trim().min(1).max(180).refine(
    (name) => name.toLowerCase().endsWith(".pdf"),
    "Choose a PDF to upload.",
  ),
  fileSize: z.number().int().positive().max(MAX_BOOK_FILE_SIZE),
  contentType: z.literal("application/pdf"),
  title: z.string().trim().max(180).optional(),
  author: z.string().trim().max(180).optional(),
});
export type BeginBookUploadInput = z.infer<
  typeof beginBookUploadInputSchema
>;

export const beginBookUploadResponseSchema = z.object({
  bookId: z.uuid(),
  uploadUrl: z.url(),
  headers: z.record(z.string(), z.string()),
});
export type BeginBookUploadResponse = z.infer<
  typeof beginBookUploadResponseSchema
>;

export const bookStatusSchema = bookSelectSchema.shape.status;
export type BookStatus = z.infer<typeof bookStatusSchema>;

export const bookListItemSchema = bookSelectSchema
  .pick({
    id: true,
    title: true,
    author: true,
    fileSize: true,
    pageCount: true,
    status: true,
    lastPage: true,
    progress: true,
    lastOpenedAt: true,
  })
  .extend({ lastOpenedAt: z.iso.datetime() });
export type BookListItem = z.infer<typeof bookListItemSchema>;

export const booksPageResponseSchema = z.object({
  books: z.array(bookListItemSchema),
  nextCursor: z.iso.datetime().nullable(),
});
export type BooksPageResponse = z.infer<typeof booksPageResponseSchema>;

export const readerBookSchema = bookSelectSchema.pick({
  id: true,
  title: true,
  author: true,
  originalFilename: true,
  fileSize: true,
  pageCount: true,
  status: true,
  lastPage: true,
  progress: true,
});
export type ReaderBook = z.infer<typeof readerBookSchema>;

export const bookResponseSchema = z.object({ book: readerBookSchema });
export type BookResponse = z.infer<typeof bookResponseSchema>;

export const uploadBookResponseSchema = z.object({
  book: readerBookSchema
    .pick({
      id: true,
      title: true,
      author: true,
      pageCount: true,
      status: true,
    })
    .extend({ createdAt: z.iso.datetime() }),
});
export type UploadBookResponse = z.infer<typeof uploadBookResponseSchema>;

export const bookProgressInputSchema = z.object({
  page: bookSelectSchema.shape.lastPage.positive(),
  progress: bookSelectSchema.shape.progress.min(0).max(1),
});
export type BookProgressInput = z.infer<typeof bookProgressInputSchema>;

export const bookProgressResponseSchema = z.object({
  book: readerBookSchema.pick({ lastPage: true, progress: true }),
});
export type BookProgressResponse = z.infer<typeof bookProgressResponseSchema>;
