import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { HighlightRect } from "@loreline/contracts/domain/reader";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_idx").on(table.token),
    index("session_user_idx").on(table.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("account_user_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const bookStatus = pgEnum("book_status", [
  "processing",
  "ready",
  "failed",
]);
export const bookIndexingStatus = pgEnum("book_indexing_status", [
  "pending",
  "indexing",
  "ready",
  "failed",
]);

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("folders_user_idx").on(table.userId),
    index("folders_parent_user_idx").on(table.parentId, table.userId),
    unique("folders_id_user_unique").on(table.id, table.userId),
    unique("folders_user_parent_name_unique")
      .on(table.userId, table.parentId, table.name)
      .nullsNotDistinct(),
    foreignKey({
      name: "folders_parent_owner_fk",
      columns: [table.parentId, table.userId],
      foreignColumns: [table.id, table.userId],
    }).onDelete("cascade"),
  ],
);

export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id"),
    title: text("title").notNull(),
    author: text("author"),
    objectKey: text("object_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull().default("application/pdf"),
    fileSize: bigint("file_size", { mode: "number" }).notNull(),
    pageCount: integer("page_count").notNull().default(1),
    status: bookStatus("status").notNull().default("processing"),
    indexingStatus: bookIndexingStatus("indexing_status")
      .notNull()
      .default("pending"),
    totalChunks: integer("total_chunks").notNull().default(0),
    indexedChunks: integer("indexed_chunks").notNull().default(0),
    indexingAttempts: integer("indexing_attempts").notNull().default(0),
    indexingError: text("indexing_error"),
    indexingUpdatedAt: timestamp("indexing_updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastPage: integer("last_page").notNull().default(1),
    progress: real("progress").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("books_folder_user_idx").on(table.folderId, table.userId),
    foreignKey({
      name: "books_folder_owner_fk",
      columns: [table.folderId, table.userId],
      foreignColumns: [folders.id, folders.userId],
    }).onDelete("cascade"),
    index("books_user_folder_recent_idx").on(
      table.userId,
      table.folderId,
      table.lastOpenedAt,
    ),
    index("books_indexing_queue_idx")
      .on(table.indexingStatus, table.indexingUpdatedAt)
      .where(sql`${table.status} = 'ready' and ${table.indexingStatus} <> 'ready'`),
  ],
);

export const BOOK_EMBEDDING_DIMENSIONS = 1536;
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export const bookChunks = pgTable(
  "book_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    content: text("content").notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce("content", ''))`,
    ),
    embedding: vector("embedding", { dimensions: BOOK_EMBEDDING_DIMENSIONS }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("book_chunks_book_user_idx").on(table.bookId, table.userId),
    index("book_chunks_search_idx").using("gin", table.searchVector),
    index("book_chunks_embedding_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .where(sql`${table.embedding} is not null`),
  ],
);

export const illustrations = pgTable(
  "illustrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    prompt: text("prompt").notNull(),
    objectKey: text("object_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("illustrations_book_idx").on(table.bookId, table.createdAt),
  ],
);

export const highlights = pgTable(
  "highlights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    text: text("text").notNull(),
    note: text("note"),
    rects: jsonb("rects")
      .$type<HighlightRect[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("highlights_book_idx").on(table.bookId, table.page)],
);

export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("bookmarks_book_user_page_idx").on(
      table.bookId,
      table.userId,
      table.page,
    ),
  ],
);

export const folderRelations = relations(folders, ({ many, one }) => ({
  parent: one(folders, {
    fields: [folders.parentId],
    references: [folders.id],
    relationName: "folderHierarchy",
  }),
  children: many(folders, { relationName: "folderHierarchy" }),
  books: many(books),
}));

export const bookRelations = relations(books, ({ many, one }) => ({
  folder: one(folders, {
    fields: [books.folderId],
    references: [folders.id],
  }),
  chunks: many(bookChunks),
  illustrations: many(illustrations),
  highlights: many(highlights),
  bookmarks: many(bookmarks),
}));
