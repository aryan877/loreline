import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import {
  bookChunks,
  books,
  conversations,
  illustrations,
  messages,
} from "../db/schema";
import { pointerSchema } from "../domain";
export { pointerSchema } from "../domain";
export type { Pointer, PointerContext } from "../domain";

const bookSelectSchema = createSelectSchema(books);
const chunkSelectSchema = createSelectSchema(bookChunks);
const conversationSelectSchema = createSelectSchema(conversations);
const illustrationSelectSchema = createSelectSchema(illustrations);
const messageSelectSchema = createSelectSchema(messages);

export const chatInputSchema = z.object({
  bookId: bookSelectSchema.shape.id,
  conversationId: conversationSelectSchema.shape.id.optional(),
  message: messageSelectSchema.shape.content.trim().min(1).max(4_000),
  page: z.number().int().positive(),
  visibleText: z.string().max(16_000).optional().default(""),
  pointer: pointerSchema.nullish(),
  screenshot: z.string().max(4_500_000).nullish(),
});
export type ChatInput = z.input<typeof chatInputSchema>;

export const chatResponseSchema = z.object({
  answer: messageSelectSchema.shape.content,
  conversationId: conversationSelectSchema.shape.id,
  messageId: messageSelectSchema.shape.id,
  createdAt: z.iso.datetime(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const searchBookInputSchema = z.object({
  bookId: bookSelectSchema.shape.id,
  query: z.string().trim().min(2).max(2_000),
  limit: z.number().int().min(1).max(12).default(5),
});
export type SearchBookInput = z.input<typeof searchBookInputSchema>;

export const searchResultSchema = chunkSelectSchema
  .pick({ pageStart: true, pageEnd: true, content: true })
  .extend({ similarity: z.number() });
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchBookResponseSchema = z.object({
  results: z.array(searchResultSchema),
});
export type SearchBookResponse = z.infer<typeof searchBookResponseSchema>;

export const illustrationInputSchema = z.object({
  bookId: bookSelectSchema.shape.id,
  page: illustrationSelectSchema.shape.page.positive(),
  prompt: illustrationSelectSchema.shape.prompt.trim().min(3).max(2_000),
  visibleText: z.string().max(10_000).optional().default(""),
});
export type IllustrationInput = z.input<typeof illustrationInputSchema>;

export const illustrationResponseSchema = z.object({
  id: illustrationSelectSchema.shape.id,
  dataUrl: z.string().startsWith("data:image/webp;base64,"),
  createdAt: z.iso.datetime(),
});
export type IllustrationResponse = z.infer<typeof illustrationResponseSchema>;

export const realtimeTokenInputSchema = z.object({
  bookTitle: bookSelectSchema.shape.title.trim().min(1).max(300).optional(),
});
export type RealtimeTokenInput = z.infer<typeof realtimeTokenInputSchema>;

export const realtimeTokenResponseSchema = z.object({
  clientSecret: z.string().min(1),
  expiresAt: z.number().int().positive(),
  model: z.string().min(1),
});
export type RealtimeTokenResponse = z.infer<typeof realtimeTokenResponseSchema>;
