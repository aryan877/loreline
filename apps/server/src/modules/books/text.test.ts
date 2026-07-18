import { describe, expect, it } from "vitest";
import { chunkPages } from "@/modules/books/text";

describe("book text chunking", () => {
  it("keeps retrieval chunks page-accurate, bounded, and overlapping", () => {
    const sentences = Array.from(
      { length: 12 },
      (_, index) => `Sentence ${index + 1} carries enough context to retrieve.`,
    );
    const [first, second] = chunkPages([sentences.join(" ")], 260, 70);

    expect(first).toMatchObject({ pageStart: 1, pageEnd: 1 });
    expect(second).toMatchObject({ pageStart: 1, pageEnd: 1 });
    expect(first.content.length).toBeLessThanOrEqual(260);
    expect(second.content).toContain("retrieve.");
    expect(second.content).toContain("Sentence");
  });
});
