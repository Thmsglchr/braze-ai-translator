import { normalizeMonacoRenderedText } from "./monacoEditorShared.js";

export interface NormalizedTextRangeMatch {
  readonly startSegmentIndex: number;
  readonly startOffset: number;
  readonly endSegmentIndex: number;
  readonly endOffset: number;
}

export function replaceTextByNormalizedMatch(
  source: string,
  selectedText: string,
  tagged: string
): string | null {
  const normalizedSelectedText = normalizeMonacoRenderedText(selectedText);
  const normalizedSource = normalizeMonacoRenderedText(source);
  const matchIndex = normalizedSource.indexOf(normalizedSelectedText);
  if (matchIndex < 0) {
    return null;
  }

  const rawMatch = findRawSubstringMatch(
    source,
    normalizedSelectedText,
    matchIndex
  );
  if (rawMatch === null) {
    return null;
  }

  return source.slice(0, rawMatch.start) + tagged + source.slice(rawMatch.end);
}

export function findRawSubstringMatch(
  source: string,
  normalizedNeedle: string,
  normalizedStartIndex: number
): { readonly start: number; readonly end: number } | null {
  let normalizedIndex = 0;
  let rawStart = -1;

  for (let rawIndex = 0; rawIndex < source.length; rawIndex += 1) {
    const normalizedChar = normalizeMonacoRenderedText(source[rawIndex] ?? "");
    if (normalizedChar.length === 0) {
      continue;
    }

    if (normalizedIndex === normalizedStartIndex && rawStart < 0) {
      rawStart = rawIndex;
    }

    normalizedIndex += normalizedChar.length;

    if (
      rawStart >= 0 &&
      normalizedIndex >= normalizedStartIndex + normalizedNeedle.length
    ) {
      return { start: rawStart, end: rawIndex + 1 };
    }
  }

  return null;
}

export function findNormalizedTextRangeInSegments(
  segments: readonly string[],
  selectedText: string
): NormalizedTextRangeMatch | null {
  const normalizedNeedle = normalizeMonacoRenderedText(selectedText);
  if (normalizedNeedle.length === 0) {
    return null;
  }

  const normalizedSegments = segments.map((segment) =>
    normalizeMonacoRenderedText(segment)
  );
  const normalizedHaystack = normalizedSegments.join("");
  const normalizedStartIndex = normalizedHaystack.indexOf(normalizedNeedle);
  if (normalizedStartIndex < 0) {
    return null;
  }

  let consumed = 0;
  let startSegmentIndex = -1;
  let startOffset = -1;
  let endSegmentIndex = -1;
  let endOffset = -1;

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex] ?? "";
    for (let rawIndex = 0; rawIndex < segment.length; rawIndex += 1) {
      const normalizedChar = normalizeMonacoRenderedText(segment[rawIndex] ?? "");
      if (normalizedChar.length === 0) {
        continue;
      }

      if (consumed === normalizedStartIndex && startSegmentIndex < 0) {
        startSegmentIndex = segmentIndex;
        startOffset = rawIndex;
      }

      consumed += normalizedChar.length;

      if (
        startSegmentIndex >= 0 &&
        consumed >= normalizedStartIndex + normalizedNeedle.length
      ) {
        endSegmentIndex = segmentIndex;
        endOffset = rawIndex + 1;
        return {
          startSegmentIndex,
          startOffset,
          endSegmentIndex,
          endOffset
        };
      }
    }
  }

  return null;
}
