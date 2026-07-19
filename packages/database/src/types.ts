import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type {
  bookmarks,
  bookChunks,
  books,
  folders,
  highlights,
  illustrations,
} from "./schema";

// These models are inferred directly from the shared Drizzle tables.
export type BookRow = InferSelectModel<typeof books>;
export type NewBookRow = InferInsertModel<typeof books>;
export type FolderRow = InferSelectModel<typeof folders>;
export type BookChunkRow = InferSelectModel<typeof bookChunks>;
export type IllustrationRow = InferSelectModel<typeof illustrations>;
export type HighlightRow = InferSelectModel<typeof highlights>;
export type BookmarkRow = InferSelectModel<typeof bookmarks>;
