import { describe, expect, it } from "vitest";
import {
  findMatchingTextRange,
  findMatchingTextRunRange,
  sentenceTextRanges,
} from "./pdf-text";

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

  it("finds a unique passage anchor when the request includes commentary", () => {
    expect(
      findMatchingTextRunRange(
        runs,
        "The author is teaching that the quieter art of noticing what changes inside us.",
      ),
    ).toEqual({ start: 1, end: 1 });
  });

  it("returns null when the passage is absent", () => {
    expect(
      findMatchingTextRunRange(runs, "A completely different claim"),
    ).toBeNull();
  });
});

describe("findMatchingTextRange", () => {
  it("returns precise character offsets for a passage anchor", () => {
    const text =
      "The first thought ends here. The quieter art of noticing begins now.";
    const passage = "Loreline explains: the quieter art of noticing.";
    const match = findMatchingTextRange(text, passage);

    expect(match && text.slice(match.start, match.end)).toBe(
      "The quieter art of noticing",
    );
  });
});
