import { z } from "zod";
import { highlightRectSchema } from "./domain/reader";

export const MAX_HIGHLIGHT_NOTE_LENGTH = 4_000;

const highlightTextSchema = z.string().trim().min(1);
const highlightNoteSchema = z
  .string()
  .trim()
  .max(MAX_HIGHLIGHT_NOTE_LENGTH)
  .nullable();

export const highlightSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  page: z.number().int().positive(),
  text: highlightTextSchema,
  note: highlightNoteSchema,
  rects: z.array(highlightRectSchema).min(1),
  createdAt: z.iso.datetime(),
});
export type Highlight = z.infer<typeof highlightSchema>;

export const highlightsResponseSchema = z.object({
  highlights: z.array(highlightSchema),
});
export type HighlightsResponse = z.infer<typeof highlightsResponseSchema>;

export const createHighlightInputSchema = z.object({
  page: z.number().int().positive(),
  text: highlightTextSchema,
  note: highlightNoteSchema.optional().default(null),
  rects: z.array(highlightRectSchema).min(1),
});
export type CreateHighlightInput = z.input<typeof createHighlightInputSchema>;

export const updateHighlightInputSchema = z.object({
  note: highlightNoteSchema,
});
export type UpdateHighlightInput = z.infer<typeof updateHighlightInputSchema>;

export const highlightResponseSchema = z.object({
  highlight: highlightSchema,
});
export type HighlightResponse = z.infer<typeof highlightResponseSchema>;
