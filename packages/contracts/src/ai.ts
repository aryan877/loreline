import { z } from "zod";

const idSchema = z.uuid();
const contentSchema = z.string();

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
  dataUrl: z
    .string()
    .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
  createdAt: z.iso.datetime(),
});
export type IllustrationResponse = z.infer<typeof illustrationResponseSchema>;

export const realtimeTokenInputSchema = z.object({
  bookTitle: z.string().trim().min(1).max(300).optional(),
});
export type RealtimeTokenInput = z.infer<typeof realtimeTokenInputSchema>;

export const realtimeTokenResponseSchema = z.object({
  clientSecret: z.string().min(1),
  expiresAt: z.number().int().positive(),
  model: z.string().min(1),
});
export type RealtimeTokenResponse = z.infer<typeof realtimeTokenResponseSchema>;

export const realtimeCompactionTurnSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  text: z.string().trim().min(1).max(12_000),
});
export type RealtimeCompactionTurn = z.infer<
  typeof realtimeCompactionTurnSchema
>;

export const realtimeMemorySchema = z.object({
  summary: z
    .string()
    .max(12_000)
    .describe("Concise chronological memory of the reading conversation."),
  readerGoals: z
    .array(z.string().max(500))
    .max(20)
    .describe("What the reader is trying to understand or accomplish."),
  importantDetails: z
    .array(z.string().max(700))
    .max(40)
    .describe(
      "Facts, preferences, decisions, and explanations worth retaining.",
    ),
  discussedPages: z
    .array(
      z.object({
        page: z.number().int().positive(),
        context: z.string().max(1_000),
      }),
    )
    .max(60)
    .describe("Book pages discussed and the relevant context from each."),
  openQuestions: z
    .array(z.string().max(500))
    .max(20)
    .describe("Unresolved questions or threads to carry into future turns."),
});
export type RealtimeMemory = z.infer<typeof realtimeMemorySchema>;

export const realtimeCompactionInputSchema = z.object({
  bookId: idSchema,
  page: z.number().int().positive(),
  previousMemory: realtimeMemorySchema.nullish(),
  turns: z.array(realtimeCompactionTurnSchema).min(1).max(500),
});
export type RealtimeCompactionInput = z.infer<
  typeof realtimeCompactionInputSchema
>;

export const realtimeCompactionResponseSchema = z.object({
  memory: realtimeMemorySchema,
});
export type RealtimeCompactionResponse = z.infer<
  typeof realtimeCompactionResponseSchema
>;
