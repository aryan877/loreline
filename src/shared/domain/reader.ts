import { z } from "zod";

export const pointerSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  text: z.string().max(2_000).optional(),
});
export type Pointer = z.infer<typeof pointerSchema>;
export type PointerContext = Pointer | null;

export const highlightRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type HighlightRect = z.infer<typeof highlightRectSchema>;
