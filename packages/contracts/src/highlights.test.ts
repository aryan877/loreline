import { describe, expect, it } from "vitest";
import { createHighlightInputSchema } from "./highlights";

describe("highlight contracts", () => {
  const input = {
    page: 2,
    text: "A line worth returning to.",
    note: "The central claim.",
    rects: [{ x: 0.1, y: 0.2, width: 0.45, height: 0.03 }],
  };

  it("accepts normalized page rectangles", () => {
    expect(createHighlightInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects rectangles outside the page", () => {
    expect(
      createHighlightInputSchema.safeParse({
        ...input,
        rects: [{ x: 0.8, y: 0.2, width: 0.3, height: 0.03 }],
      }).success,
    ).toBe(false);
  });

  it("supports a dense full-page selection", () => {
    const rect = { x: 0.1, y: 0.2, width: 0.45, height: 0.03 };
    expect(
      createHighlightInputSchema.safeParse({
        ...input,
        text: "A ".repeat(8_000),
        rects: Array.from({ length: 512 }, () => rect),
      }).success,
    ).toBe(true);
  });
});
