import { z } from "zod";
import { pointerSchema } from "./domain/reader";

const idSchema = z.uuid();
const contentSchema = z.string();

export { pointerSchema } from "./domain/reader";
export type { Pointer, PointerContext } from "./domain/reader";

export const chatInputSchema = z.object({
  bookId: idSchema,
  conversationId: idSchema.optional(),
  message: contentSchema.trim().min(1).max(4_000),
  page: z.number().int().positive(),
  visibleText: z.string().max(16_000).optional().default(""),
  pointer: pointerSchema.nullish(),
  screenshot: z.string().max(4_500_000).nullish(),
});
export type ChatInput = z.input<typeof chatInputSchema>;

export const chatResponseSchema = z.object({
  answer: contentSchema,
  conversationId: idSchema,
  messageId: idSchema,
  createdAt: z.iso.datetime(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const searchBookInputSchema = z.object({
  bookId: idSchema,
  query: z.string().trim().min(2).max(2_000),
  limit: z.number().int().min(1).max(12).default(5),
});
export type SearchBookInput = z.input<typeof searchBookInputSchema>;

export const searchResultSchema = z.object({
  pageStart: z.number().int().positive(),
  pageEnd: z.number().int().positive(),
  content: contentSchema,
  similarity: z.number(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchBookResponseSchema = z.object({
  results: z.array(searchResultSchema),
});
export type SearchBookResponse = z.infer<typeof searchBookResponseSchema>;

export const illustrationInputSchema = z.object({
  bookId: idSchema,
  page: z.number().int().positive(),
  prompt: z.string().trim().min(3).max(2_000),
  visibleText: z.string().max(10_000).optional().default(""),
});
export type IllustrationInput = z.input<typeof illustrationInputSchema>;

export const illustrationResponseSchema = z.object({
  id: idSchema,
  dataUrl: z.string().startsWith("data:image/webp;base64,"),
  createdAt: z.iso.datetime(),
});
export type IllustrationResponse = z.infer<
  typeof illustrationResponseSchema
>;

export const realtimeTokenInputSchema = z.object({
  bookTitle: z.string().trim().min(1).max(300).optional(),
});
export type RealtimeTokenInput = z.infer<typeof realtimeTokenInputSchema>;

export const realtimeTokenResponseSchema = z.object({
  clientSecret: z.string().min(1),
  expiresAt: z.number().int().positive(),
  model: z.string().min(1),
});
export type RealtimeTokenResponse = z.infer<
  typeof realtimeTokenResponseSchema
>;
