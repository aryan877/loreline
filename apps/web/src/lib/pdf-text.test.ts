import { describe, expect, it } from "vitest";
import {
  edgeAutoScrollVelocity,
  findMatchingTextRunRange,
  sentenceTextRanges,
} from "./pdf-text";

describe("edgeAutoScrollVelocity", () => {
  it("scrolls toward the nearest viewport edge and rests in the middle", () => {
    expect(edgeAutoScrollVelocity(110, 100, 800)).toBeLessThan(0);
    expect(edgeAutoScrollVelocity(500, 100, 800)).toBe(0);
    expect(edgeAutoScrollVelocity(890, 100, 800)).toBeGreaterThan(0);
  });
});

describe("sentenceTextRanges", () => {
  it("keeps sentence boundaries across PDF text-run whitespace", () => {
    expect(
      sentenceTextRanges(
        "  Dr. Shiloah kept the plan secret.\nThe organization changed later.  ",
      ).map(({ text }) => text),
    ).toEqual([
      "Dr. Shiloah kept the plan secret.",
      "The organization changed later.",
    ]);
  });
});

describe("findMatchingTextRunRange", () => {
  const runs = [
    "Reading is not the act of moving quickly across a page.",
    "It is the quieter art of noticing what changes inside us.",
    "A note remains attached to that moment.",
  ];

  it("matches a passage inside one PDF text run", () => {
    expect(findMatchingTextRunRange(runs, "quieter art of noticing")).toEqual({
      start: 1,
      end: 1,
    });
  });

  it("matches across adjacent PDF text runs", () => {
    expect(
      findMatchingTextRunRange(runs, "across a page. It is the quieter art"),
    ).toEqual({ start: 0, end: 1 });
  });

  it("normalizes punctuation and case", () => {
    expect(findMatchingTextRunRange(runs, "A NOTE—remains attached")).toEqual({
      start: 2,
      end: 2,
    });
  });

  it("returns null when the passage is absent", () => {
    expect(
      findMatchingTextRunRange(runs, "A completely different claim"),
    ).toBeNull();
  });
});
