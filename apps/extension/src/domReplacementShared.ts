import { normalizeMonacoRenderedText } from "./monacoEditorShared.js";

export interface NormalizedTextRangeMatch {
  readonly startSegmentIndex: number;
  readonly startOffset: number;
  readonly endSegmentIndex: number;
  readonly endOffset: number;
}

const NORMALIZED_TRANSLATION_BLOCK_START = "{% translation";
const NORMALIZED_TRANSLATION_BLOCK_END = "{% endtranslation %}";

export function findNormalizedMatchOutsideTranslationTags(
  source: string,
  selectedText: string
): number {
  const normalizedSelectedText = normalizeMonacoRenderedText(selectedText);
  if (normalizedSelectedText.length === 0) {
    return -1;
  }

  const normalizedSource = normalizeMonacoRenderedText(source);
  const wrappedRanges = findNormalizedTranslationContentRanges(normalizedSource);
  let searchStartIndex = 0;

  while (true) {
    const matchIndex = normalizedSource.indexOf(
      normalizedSelectedText,
      searchStartIndex
    );
    if (matchIndex < 0) {
      return -1;
    }

    const matchEndIndex = matchIndex + normalizedSelectedText.length;
    const isWrapped = wrappedRanges.some(
      (range) => matchIndex >= range.start && matchEndIndex <= range.end
    );
    if (!isWrapped) {
      return matchIndex;
    }

    searchStartIndex = matchIndex + 1;
  }
}

export function replaceTextByNormalizedMatch(
  source: string,
  selectedText: string,
  tagged: string
): string | null {
  const normalizedSelectedText = normalizeMonacoRenderedText(selectedText);
  const matchIndex = findNormalizedMatchOutsideTranslationTags(
    source,
    selectedText
  );
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

function findNormalizedTranslationContentRanges(
  normalizedSource: string
): ReadonlyArray<{ readonly start: number; readonly end: number }> {
  const ranges: Array<{ readonly start: number; readonly end: number }> = [];
  let searchIndex = 0;

  while (true) {
    const blockStartIndex = normalizedSource.indexOf(
      NORMALIZED_TRANSLATION_BLOCK_START,
      searchIndex
    );
    if (blockStartIndex < 0) {
      break;
    }

    const openTagEndIndex = normalizedSource.indexOf("%}", blockStartIndex);
    if (openTagEndIndex < 0) {
      break;
    }

    const contentStartIndex = openTagEndIndex + 2;
    const blockEndIndex = normalizedSource.indexOf(
      NORMALIZED_TRANSLATION_BLOCK_END,
      contentStartIndex
    );
    if (blockEndIndex < 0) {
      break;
    }

    ranges.push({ start: contentStartIndex, end: blockEndIndex });
    searchIndex = blockEndIndex + NORMALIZED_TRANSLATION_BLOCK_END.length;
  }

  return ranges;
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
