export type TextRunRange = { start: number; end: number };
export type TextRange = { start: number; end: number };
export type SentenceTextRange = {
  start: number;
  end: number;
  text: string;
};

export function sentenceTextRanges(text: string): SentenceTextRange[] {
  const segmenter = new Intl.Segmenter(undefined, {
    granularity: "sentence",
  });
  const segmented = Array.from(segmenter.segment(text)).flatMap((part) => {
    const leadingSpace = part.segment.search(/\S/);
    if (leadingSpace < 0) return [];
    const trailingSpace = part.segment.length - part.segment.trimEnd().length;
    const start = part.index + leadingSpace;
    const end = part.index + part.segment.length - trailingSpace;
    const sentence = text.slice(start, end).replace(/\s+/g, " ").trim();
    return sentence ? [{ start, end, text: sentence }] : [];
  });
  const ranges: SentenceTextRange[] = [];
  const titleAbbreviation =
    /\b(?:mr|mrs|ms|dr|prof|gen|col|lt|capt|sgt|rev|hon|pres|gov|sen|rep|st)\.$/i;
  for (const sentence of segmented) {
    const previous = ranges.at(-1);
    if (previous && titleAbbreviation.test(previous.text)) {
      previous.end = sentence.end;
      previous.text = `${previous.text} ${sentence.text}`;
    } else {
      ranges.push({ ...sentence });
    }
  }
  return ranges;
}

export function normalizePdfText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type PdfTextToken = TextRange & { value: string };

function pdfTextTokens(value: string): PdfTextToken[] {
  return Array.from(value.matchAll(/[\p{L}\p{N}]+/gu)).flatMap((match) => {
    const token = match[0];
    const start = match.index;
    if (!token || start === undefined) return [];
    return [
      {
        value: token.normalize("NFKC").toLocaleLowerCase(),
        start,
        end: start + token.length,
      },
    ];
  });
}

function sequenceMatches(
  textTokens: PdfTextToken[],
  passageTokens: PdfTextToken[],
  passageStart: number,
  length: number,
) {
  const matches: number[] = [];
  for (let textStart = 0; textStart + length <= textTokens.length; textStart++) {
    let matchesWindow = true;
    for (let offset = 0; offset < length; offset++) {
      if (
        textTokens[textStart + offset]?.value !==
        passageTokens[passageStart + offset]?.value
      ) {
        matchesWindow = false;
        break;
      }
    }
    if (matchesWindow) matches.push(textStart);
  }
  return matches;
}

function matchingTokenRange(
  textTokens: PdfTextToken[],
  passageTokens: PdfTextToken[],
) {
  if (!textTokens.length || !passageTokens.length) return null;

  const exact = sequenceMatches(
    textTokens,
    passageTokens,
    0,
    passageTokens.length,
  );
  if (exact.length) {
    const start = exact[0]!;
    return { start, end: start + passageTokens.length - 1 };
  }

  const largestAnchor = Math.min(16, passageTokens.length);
  for (let length = largestAnchor; length >= 4; length--) {
    for (
      let passageStart = 0;
      passageStart + length <= passageTokens.length;
      passageStart++
    ) {
      const matches = sequenceMatches(
        textTokens,
        passageTokens,
        passageStart,
        length,
      );
      if (matches.length === 1)
        return { start: matches[0]!, end: matches[0]! + length - 1 };
    }
  }
  return null;
}

export function findMatchingTextRange(
  text: string,
  passage: string,
): TextRange | null {
  const textTokens = pdfTextTokens(text);
  const passageTokens = pdfTextTokens(passage);
  const match = matchingTokenRange(textTokens, passageTokens);
  if (!match) return null;
  return {
    start: textTokens[match.start]!.start,
    end: textTokens[match.end]!.end,
  };
}

export function findMatchingTextRunRange(
  runs: string[],
  passage: string,
): TextRunRange | null {
  const normalizedRuns = runs.map(normalizePdfText);
  const offsets: Array<{ start: number; end: number }> = [];
  let joined = "";

  for (const run of normalizedRuns) {
    if (!run) {
      offsets.push({ start: joined.length, end: joined.length });
      continue;
    }
    if (joined) joined += " ";
    const start = joined.length;
    joined += run;
    offsets.push({ start, end: joined.length });
  }

  const match = findMatchingTextRange(joined, passage);
  if (!match) return null;
  const matchStart = match.start;
  const matchEnd = match.end;
  const start = offsets.findIndex(
    (offset) => offset.end > matchStart && offset.start < matchEnd,
  );
  if (start < 0) return null;
  let end = start;
  for (let index = start; index < offsets.length; index++) {
    if (offsets[index]!.start >= matchEnd) break;
    if (offsets[index]!.end > matchStart) end = index;
  }
  return { start, end };
}
