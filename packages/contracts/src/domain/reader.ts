import { z } from "zod";

export type Pointer = {
  x: number;
  y: number;
  text?: string;
};
export type PointerContext = Pointer | null;

export const highlightRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (rect) => rect.x + rect.width <= 1.001 && rect.y + rect.height <= 1.001,
    "Highlight rectangles must stay within the page.",
  );
export type HighlightRect = z.infer<typeof highlightRectSchema>;
