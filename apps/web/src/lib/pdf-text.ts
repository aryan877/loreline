export type TextRunRange = { start: number; end: number };

export function normalizePdfText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
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

  const normalizedPassage = normalizePdfText(passage);
  if (!normalizedPassage) return null;

  let matchStart = joined.indexOf(normalizedPassage);
  let matchLength = normalizedPassage.length;
  if (matchStart < 0) {
    const words = normalizedPassage.split(" ").filter(Boolean);
    if (words.length < 4) return null;
    const anchor = words.slice(0, Math.min(8, words.length)).join(" ");
    matchStart = joined.indexOf(anchor);
    matchLength = anchor.length;
  }
  if (matchStart < 0) return null;

  const matchEnd = matchStart + matchLength;
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
