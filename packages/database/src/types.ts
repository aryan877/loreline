import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type {
  bookmarks,
  bookChunks,
  books,
  conversations,
  highlights,
  illustrations,
  messages,
} from "./schema";

// These models are inferred directly from the shared Drizzle tables.
export type BookRow = InferSelectModel<typeof books>;
export type NewBookRow = InferInsertModel<typeof books>;
export type BookChunkRow = InferSelectModel<typeof bookChunks>;
export type ConversationRow = InferSelectModel<typeof conversations>;
export type MessageRow = InferSelectModel<typeof messages>;
export type IllustrationRow = InferSelectModel<typeof illustrations>;
export type HighlightRow = InferSelectModel<typeof highlights>;
export type BookmarkRow = InferSelectModel<typeof bookmarks>;
