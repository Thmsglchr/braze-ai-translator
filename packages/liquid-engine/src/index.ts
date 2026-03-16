import { createHash } from "node:crypto";

import {
  ExtractedContentPayloadSchema,
  TransformResultSchema,
  ValidationErrorSchema,
  type BrazeMessageChannel,
  type ContentFieldType,
  type ExtractedContentPayload,
  type TransformResult,
  type TranslationEntry,
  type ValidationError
} from "@braze-ai-translator/schemas";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const CONTEXT_WINDOW_SIZE = 20;
const SKIPPED_HTML_TAG_NAMES = new Set(["script", "style"]);
const INLINE_LIQUID_TAG_NAMES = new Set([
  "if",
  "elsif",
  "else",
  "endif",
  "unless",
  "endunless",
  "case",
  "when",
  "endcase",
  "for",
  "endfor",
  "tablerow",
  "endtablerow"
]);
const DISALLOWED_LIQUID_TAG_NAMES = new Set(["translation", "endtranslation"]);

type StructuralTokenKind =
  | "text"
  | "html_tag"
  | "liquid_output"
  | "liquid_tag";

interface StructuralToken {
  readonly kind: StructuralTokenKind;
  readonly startOffset: number;
  readonly endOffsetExclusive: number;
  readonly value: string;
  readonly tagName?: string;
}

interface CandidateSpan {
  readonly startOffset: number;
  readonly endOffsetExclusive: number;
  readonly sourceText: string;
  readonly plainText: string;
  readonly preservedLiquidBlocks: readonly string[];
}

interface AnalysisResult {
  readonly candidateSpans: readonly CandidateSpan[];
  readonly detectedLiquid: boolean;
  readonly validationErrors: readonly ValidationError[];
}

interface NormalizedLiquidTaggingRequest {
  readonly rawContent: string;
  readonly contentFieldKey: string;
  readonly contentFieldType: ContentFieldType;
  readonly extractionId: string;
  readonly transformId: string;
  readonly sourceLocale: string;
  readonly messageChannel: BrazeMessageChannel;
  readonly sourceWorkspaceId?: string;
  readonly sourceCampaignId?: string;
  readonly sourceCanvasId?: string;
  readonly sourceMessageId: string;
  readonly sourceMessageVariantId?: string;
  readonly extractedAt: string;
  readonly generatedAt: string;
}

export interface LiquidInspectionResult {
  readonly original: string;
  readonly contentFieldType: ContentFieldType;
  readonly detectedLiquid: boolean;
  readonly translatableSegments: readonly string[];
  readonly validationErrors: readonly ValidationError[];
}

export interface LiquidTaggingRequest {
  readonly rawContent: string;
  readonly contentFieldKey?: string;
  readonly contentFieldType?: ContentFieldType;
  readonly extractionId?: string;
  readonly transformId?: string;
  readonly sourceLocale?: string;
  readonly messageChannel?: BrazeMessageChannel;
  readonly sourceWorkspaceId?: string;
  readonly sourceCampaignId?: string;
  readonly sourceCanvasId?: string;
  readonly sourceMessageId?: string;
  readonly sourceMessageVariantId?: string;
  readonly extractedAt?: string;
  readonly generatedAt?: string;
}

export interface LiquidTaggingResult extends LiquidInspectionResult {
  readonly transformedContent: string | null;
  readonly translationEntries: readonly TranslationEntry[];
  readonly extractedContentPayload: ExtractedContentPayload;
  readonly transformResult: TransformResult;
}

interface CandidateBuilder {
  startOffset: number;
  endOffsetExclusive: number;
  plainText: string;
  preservedLiquidBlocks: string[];
}

interface HtmlTagScanResult {
  readonly endOffsetExclusive: number;
  readonly tagName?: string;
}

export function inspectLiquidTemplate(template: string): LiquidInspectionResult {
  const contentFieldType = inferContentFieldType(template);
  const analysis = analyzeContent(template, contentFieldType);

  return {
    original: template,
    contentFieldType,
    detectedLiquid: analysis.detectedLiquid,
    translatableSegments: analysis.candidateSpans.map((span) => span.sourceText),
    validationErrors: analysis.validationErrors
  };
}

export function tagLiquidTemplate(
  requestOrContent: LiquidTaggingRequest | string
): LiquidTaggingResult {
  const request = normalizeRequest(requestOrContent);
  const analysis = analyzeContent(request.rawContent, request.contentFieldType);
  const validationErrors = analysis.validationErrors;
  const translationEntries =
    validationErrors.length === 0
      ? analysis.candidateSpans.map((span, index) =>
          createTranslationEntry(request, span, index)
        )
      : [];

  const transformedContent =
    validationErrors.length === 0
      ? insertTranslationTags(request.rawContent, translationEntries)
      : null;

  const extractedContentPayload = ExtractedContentPayloadSchema.parse({
    extractionId: request.extractionId,
    sourcePlatform: "braze",
    sourceWorkspaceId: request.sourceWorkspaceId,
    sourceCampaignId: request.sourceCampaignId,
    sourceCanvasId: request.sourceCanvasId,
    sourceMessageId: request.sourceMessageId,
    sourceMessageVariantId: request.sourceMessageVariantId,
    messageChannel: request.messageChannel,
    contentFieldKey: request.contentFieldKey,
    contentFieldType: request.contentFieldType,
    sourceLocale: request.sourceLocale,
    rawContent: request.rawContent,
    contentChecksum: createChecksum(request.rawContent),
    detectedLiquid: analysis.detectedLiquid,
    translationEntries,
    validationErrors,
    extractedAt: request.extractedAt
  });

  const transformResult = TransformResultSchema.parse({
    transformId: request.transformId,
    extractionId: request.extractionId,
    transformStatus: validationErrors.length === 0 ? "success" : "failed",
    originalContent: request.rawContent,
    transformedContent,
    contentChanged:
      transformedContent !== null && transformedContent !== request.rawContent,
    appliedTranslationTagCount: transformedContent === null
      ? 0
      : translationEntries.length,
    translationEntries,
    validationErrors,
    generatedAt: request.generatedAt
  });

  return {
    original: request.rawContent,
    contentFieldType: request.contentFieldType,
    detectedLiquid: analysis.detectedLiquid,
    translatableSegments: analysis.candidateSpans.map((span) => span.sourceText),
    validationErrors,
    transformedContent,
    translationEntries,
    extractedContentPayload,
    transformResult
  };
}

function normalizeRequest(
  requestOrContent: LiquidTaggingRequest | string
): NormalizedLiquidTaggingRequest {
  const rawContent =
    typeof requestOrContent === "string"
      ? requestOrContent
      : requestOrContent.rawContent;
  const rawContentChecksum = createChecksum(rawContent);
  const contentFieldType =
    typeof requestOrContent === "string"
      ? inferContentFieldType(rawContent)
      : requestOrContent.contentFieldType ?? inferContentFieldType(rawContent);
  const defaultFieldKey =
    contentFieldType === "html" ? "message.body_html" : "message.body_text";

  if (typeof requestOrContent === "string") {
    return {
      rawContent,
      contentFieldKey: defaultFieldKey,
      contentFieldType,
      extractionId: createDeterministicIdentifier("extract", rawContentChecksum),
      transformId: createDeterministicIdentifier("transform", rawContentChecksum),
      sourceLocale: "und",
      messageChannel: "email",
      sourceMessageId: createDeterministicIdentifier("message", rawContentChecksum),
      extractedAt: DEFAULT_TIMESTAMP,
      generatedAt: DEFAULT_TIMESTAMP
    };
  }

  return {
    rawContent,
    contentFieldKey: requestOrContent.contentFieldKey ?? defaultFieldKey,
    contentFieldType,
    extractionId:
      requestOrContent.extractionId ??
      createDeterministicIdentifier("extract", rawContentChecksum),
    transformId:
      requestOrContent.transformId ??
      createDeterministicIdentifier("transform", rawContentChecksum),
    sourceLocale: requestOrContent.sourceLocale ?? "und",
    messageChannel: requestOrContent.messageChannel ?? "email",
    sourceWorkspaceId: requestOrContent.sourceWorkspaceId,
    sourceCampaignId: requestOrContent.sourceCampaignId,
    sourceCanvasId: requestOrContent.sourceCanvasId,
    sourceMessageId:
      requestOrContent.sourceMessageId ??
      createDeterministicIdentifier("message", rawContentChecksum),
    sourceMessageVariantId: requestOrContent.sourceMessageVariantId,
    extractedAt: requestOrContent.extractedAt ?? DEFAULT_TIMESTAMP,
    generatedAt: requestOrContent.generatedAt ?? DEFAULT_TIMESTAMP
  };
}

function analyzeContent(
  rawContent: string,
  contentFieldType: ContentFieldType
): AnalysisResult {
  if (rawContent.length === 0) {
    return {
      candidateSpans: [],
      detectedLiquid: false,
      validationErrors: [
        createValidationError({
          errorCode: "invalid_input",
          message: "Template content must not be empty.",
          fieldPathSegments: ["rawContent"]
        })
      ]
    };
  }

  const liquidValidation = validateLiquidTokens(rawContent);

  if (liquidValidation.validationErrors.length > 0) {
    return {
      candidateSpans: [],
      detectedLiquid: liquidValidation.detectedLiquid,
      validationErrors: liquidValidation.validationErrors
    };
  }

  const tokenization = tokenizeContent(
    rawContent,
    contentFieldType === "html"
  );

  if (tokenization.validationErrors.length > 0) {
    return {
      candidateSpans: [],
      detectedLiquid:
        liquidValidation.detectedLiquid || tokenization.detectedLiquid,
      validationErrors: tokenization.validationErrors
    };
  }

  const liquidTagValidationErrors = validateSupportedLiquidTags(tokenization.tokens);

  if (liquidTagValidationErrors.length > 0) {
    return {
      candidateSpans: [],
      detectedLiquid:
        liquidValidation.detectedLiquid || tokenization.detectedLiquid,
      validationErrors: liquidTagValidationErrors
    };
  }

  return {
    candidateSpans: collectCandidateSpans(rawContent, tokenization.tokens),
    detectedLiquid: liquidValidation.detectedLiquid || tokenization.detectedLiquid,
    validationErrors: []
  };
}

function validateSupportedLiquidTags(
  tokens: readonly StructuralToken[]
): readonly ValidationError[] {
  const validationErrors: ValidationError[] = [];

  for (const token of tokens) {
    if (token.kind !== "liquid_tag") {
      continue;
    }

    const liquidTagName = getLiquidTagName(token.value);

    if (liquidTagName === null) {
      continue;
    }

    if (DISALLOWED_LIQUID_TAG_NAMES.has(liquidTagName)) {
      validationErrors.push(
        createValidationError({
          errorCode: "unsupported_content",
          message:
            "Existing Braze translation tags are not supported as transform input.",
          fieldPathSegments: ["rawContent"],
          sourceRange: {
            startOffset: token.startOffset,
            endOffsetExclusive: token.endOffsetExclusive
          }
        })
      );
      break;
    }
  }

  return validationErrors;
}

function validateLiquidTokens(rawContent: string): {
  readonly detectedLiquid: boolean;
  readonly validationErrors: readonly ValidationError[];
} {
  const validationErrors: ValidationError[] = [];
  let detectedLiquid = false;

  for (let index = 0; index < rawContent.length; index += 1) {
    const skipEnd = skipNonLiquidBlock(rawContent, index);

    if (skipEnd !== null) {
      index = skipEnd - 1;
      continue;
    }

    if (rawContent.startsWith("{{", index)) {
      detectedLiquid = true;
      const endOffsetExclusive = findLiquidTokenEnd(rawContent, index + 2, "}}");

      if (endOffsetExclusive === -1) {
        validationErrors.push(
          createValidationError({
            errorCode: "invalid_liquid_syntax",
            message: `Liquid output block starting at index ${index} is not closed.`,
            fieldPathSegments: ["rawContent"],
            sourceRange: {
              startOffset: index,
              endOffsetExclusive: rawContent.length
            }
          })
        );
        break;
      }

      index = endOffsetExclusive - 1;
      continue;
    }

    if (rawContent.startsWith("{%", index)) {
      detectedLiquid = true;
      const endOffsetExclusive = findLiquidTokenEnd(rawContent, index + 2, "%}");

      if (endOffsetExclusive === -1) {
        validationErrors.push(
          createValidationError({
            errorCode: "invalid_liquid_syntax",
            message: `Liquid tag block starting at index ${index} is not closed.`,
            fieldPathSegments: ["rawContent"],
            sourceRange: {
              startOffset: index,
              endOffsetExclusive: rawContent.length
            }
          })
        );
        break;
      }

      index = endOffsetExclusive - 1;
      continue;
    }

    if (rawContent.startsWith("}}", index) || rawContent.startsWith("%}", index)) {
      validationErrors.push(
        createValidationError({
          errorCode: "invalid_liquid_syntax",
          message: `Unexpected Liquid closing delimiter at index ${index}.`,
          fieldPathSegments: ["rawContent"],
          sourceRange: {
            startOffset: index,
            endOffsetExclusive: Math.min(rawContent.length, index + 2)
          }
        })
      );
      break;
    }
  }

  return {
    detectedLiquid,
    validationErrors
  };
}

function skipNonLiquidBlock(
  rawContent: string,
  index: number
): number | null {
  if (rawContent.startsWith("<!--", index)) {
    const commentEnd = rawContent.indexOf("-->", index + 4);

    return commentEnd !== -1 ? commentEnd + 3 : rawContent.length;
  }

  for (const tagName of SKIPPED_HTML_TAG_NAMES) {
    const openTag = `<${tagName}`;

    if (
      rawContent.startsWith(openTag, index) &&
      !rawContent.startsWith("</", index)
    ) {
      const nextChar = rawContent[index + openTag.length];

      if (nextChar === ">" || nextChar === " " || nextChar === "\n") {
        const closeTag = `</${tagName}>`;
        const closeIndex = rawContent.indexOf(closeTag, index);

        return closeIndex !== -1
          ? closeIndex + closeTag.length
          : rawContent.length;
      }
    }
  }

  return null;
}

function tokenizeContent(
  rawContent: string,
  htmlMode: boolean
): {
  readonly tokens: readonly StructuralToken[];
  readonly detectedLiquid: boolean;
  readonly validationErrors: readonly ValidationError[];
} {
  const tokens: StructuralToken[] = [];
  const validationErrors: ValidationError[] = [];
  let detectedLiquid = false;
  let cursor = 0;
  let textStart = 0;

  while (cursor < rawContent.length) {
    if (rawContent.startsWith("{{", cursor)) {
      detectedLiquid = true;
      pushTextToken(tokens, rawContent, textStart, cursor);

      const endOffsetExclusive = findLiquidTokenEnd(rawContent, cursor + 2, "}}");

      if (endOffsetExclusive === -1) {
        break;
      }

      tokens.push({
        kind: "liquid_output",
        startOffset: cursor,
        endOffsetExclusive,
        value: rawContent.slice(cursor, endOffsetExclusive)
      });
      cursor = endOffsetExclusive;
      textStart = cursor;
      continue;
    }

    if (rawContent.startsWith("{%", cursor)) {
      detectedLiquid = true;
      pushTextToken(tokens, rawContent, textStart, cursor);

      const endOffsetExclusive = findLiquidTokenEnd(rawContent, cursor + 2, "%}");

      if (endOffsetExclusive === -1) {
        break;
      }

      tokens.push({
        kind: "liquid_tag",
        startOffset: cursor,
        endOffsetExclusive,
        value: rawContent.slice(cursor, endOffsetExclusive)
      });
      cursor = endOffsetExclusive;
      textStart = cursor;
      continue;
    }

    if (htmlMode && rawContent[cursor] === "<" && isHtmlTagStart(rawContent, cursor)) {
      pushTextToken(tokens, rawContent, textStart, cursor);

      const htmlTagScanResult = scanHtmlTag(rawContent, cursor);

      if (htmlTagScanResult === null) {
        validationErrors.push(
          createValidationError({
            errorCode: "invalid_input",
            message: `HTML tag starting at index ${cursor} is not closed.`,
            fieldPathSegments: ["rawContent"],
            sourceRange: {
              startOffset: cursor,
              endOffsetExclusive: rawContent.length
            }
          })
        );
        break;
      }

      if (
        htmlTagScanResult.tagName !== undefined &&
        SKIPPED_HTML_TAG_NAMES.has(htmlTagScanResult.tagName) &&
        !rawContent.startsWith("</", cursor)
      ) {
        const closingTag = `</${htmlTagScanResult.tagName}>`;
        const closingIndex = rawContent.indexOf(
          closingTag,
          htmlTagScanResult.endOffsetExclusive
        );

        if (closingIndex !== -1) {
          cursor = closingIndex + closingTag.length;
        } else {
          cursor = rawContent.length;
        }

        textStart = cursor;
        continue;
      }

      tokens.push({
        kind: "html_tag",
        startOffset: cursor,
        endOffsetExclusive: htmlTagScanResult.endOffsetExclusive,
        value: rawContent.slice(cursor, htmlTagScanResult.endOffsetExclusive),
        tagName: htmlTagScanResult.tagName
      });
      cursor = htmlTagScanResult.endOffsetExclusive;
      textStart = cursor;
      continue;
    }

    cursor += 1;
  }

  pushTextToken(tokens, rawContent, textStart, cursor);

  return {
    tokens,
    detectedLiquid,
    validationErrors
  };
}

function collectCandidateSpans(
  rawContent: string,
  tokens: readonly StructuralToken[]
): readonly CandidateSpan[] {
  const candidateSpans: CandidateSpan[] = [];
  let activeBuilder: CandidateBuilder | null = null;

  const flushBuilder = (): void => {
    if (activeBuilder === null) {
      return;
    }

    const sourceText = rawContent.slice(
      activeBuilder.startOffset,
      activeBuilder.endOffsetExclusive
    );

    if (isTranslatableCandidate(activeBuilder.plainText)) {
      candidateSpans.push({
        startOffset: activeBuilder.startOffset,
        endOffsetExclusive: activeBuilder.endOffsetExclusive,
        sourceText,
        plainText: activeBuilder.plainText,
        preservedLiquidBlocks: [...activeBuilder.preservedLiquidBlocks]
      });
    }

    activeBuilder = null;
  };

  const appendRange = (startOffset: number, endOffsetExclusive: number): void => {
    const value = rawContent.slice(startOffset, endOffsetExclusive);

    if (activeBuilder === null) {
      activeBuilder = {
        startOffset,
        endOffsetExclusive,
        plainText: value,
        preservedLiquidBlocks: []
      };
      return;
    }

    activeBuilder.endOffsetExclusive = endOffsetExclusive;
    activeBuilder.plainText += value;
  };

  const appendLiquidToken = (token: StructuralToken): void => {
    if (activeBuilder === null) {
      activeBuilder = {
        startOffset: token.startOffset,
        endOffsetExclusive: token.endOffsetExclusive,
        plainText: "",
        preservedLiquidBlocks: [token.value]
      };
      return;
    }

    activeBuilder.endOffsetExclusive = token.endOffsetExclusive;
    activeBuilder.preservedLiquidBlocks.push(token.value);
  };

  for (const token of tokens) {
    switch (token.kind) {
      case "text":
        appendTextTokenRanges(token, appendRange, flushBuilder);
        break;
      case "liquid_output":
        appendLiquidToken(token);
        break;
      case "liquid_tag":
        if (shouldKeepLiquidTagWithinTranslation(token.value)) {
          appendLiquidToken(token);
          break;
        }

        flushBuilder();
        break;
      case "html_tag":
        flushBuilder();
        break;
    }
  }

  flushBuilder();

  return candidateSpans;
}

function appendTextTokenRanges(
  token: StructuralToken,
  appendRange: (startOffset: number, endOffsetExclusive: number) => void,
  flushBuilder: () => void
): void {
  let chunkStartOffset = token.startOffset;

  for (
    let index = token.startOffset;
    index < token.endOffsetExclusive;
    index += 1
  ) {
    const character = token.value[index - token.startOffset];

    if (character !== "\n" && character !== "\r") {
      continue;
    }

    if (chunkStartOffset < index) {
      appendRange(chunkStartOffset, index);
    }

    flushBuilder();

    if (character === "\r" && token.value[index - token.startOffset + 1] === "\n") {
      index += 1;
    }

    chunkStartOffset = index + 1;
  }

  if (chunkStartOffset < token.endOffsetExclusive) {
    appendRange(chunkStartOffset, token.endOffsetExclusive);
  }
}

function insertTranslationTags(
  rawContent: string,
  translationEntries: readonly TranslationEntry[]
): string {
  let taggedContent = "";
  let cursor = 0;

  for (const translationEntry of translationEntries) {
    taggedContent += rawContent.slice(cursor, translationEntry.sourceRange.startOffset);
    taggedContent += createTranslationBlock(
      translationEntry.entryId,
      translationEntry.sourceText
    );
    cursor = translationEntry.sourceRange.endOffsetExclusive;
  }

  taggedContent += rawContent.slice(cursor);

  return taggedContent;
}

function createTranslationEntry(
  request: NormalizedLiquidTaggingRequest,
  candidateSpan: CandidateSpan,
  index: number
): TranslationEntry {
  const entryId = `item_${index + 1}`;

  return {
    entryId,
    extractionId: request.extractionId,
    sourceLocale: request.sourceLocale,
    messageChannel: request.messageChannel,
    contentFieldKey: request.contentFieldKey,
    contentFieldType: request.contentFieldType,
    sourceText: candidateSpan.sourceText,
    sourceTextChecksum: createChecksum(candidateSpan.sourceText),
    sourceRange: {
      startOffset: candidateSpan.startOffset,
      endOffsetExclusive: candidateSpan.endOffsetExclusive
    },
    surroundingTextBefore: request.rawContent.slice(
      Math.max(0, candidateSpan.startOffset - CONTEXT_WINDOW_SIZE),
      candidateSpan.startOffset
    ),
    surroundingTextAfter: request.rawContent.slice(
      candidateSpan.endOffsetExclusive,
      Math.min(
        request.rawContent.length,
        candidateSpan.endOffsetExclusive + CONTEXT_WINDOW_SIZE
      )
    ),
    preservedLiquidBlocks: [...candidateSpan.preservedLiquidBlocks]
  };
}

function inferContentFieldType(rawContent: string): ContentFieldType {
  return looksLikeHtml(rawContent) ? "html" : "plain_text";
}

function looksLikeHtml(rawContent: string): boolean {
  const trimmed = rawContent.trimStart();

  if (trimmed.length === 0) {
    return false;
  }

  if (trimmed.startsWith("<!--")) {
    return true;
  }

  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<!doctype")) {
    return true;
  }

  return /^<\/?[A-Za-z][^>]*>/.test(trimmed);
}

function isHtmlTagStart(rawContent: string, offset: number): boolean {
  const nextCharacter = rawContent[offset + 1];

  if (nextCharacter === undefined) {
    return false;
  }

  return /[A-Za-z!/]/.test(nextCharacter);
}

function scanHtmlTag(
  rawContent: string,
  tagStartOffset: number
): HtmlTagScanResult | null {
  if (rawContent.startsWith("<!--", tagStartOffset)) {
    const commentEndOffset = rawContent.indexOf("-->", tagStartOffset + 4);

    if (commentEndOffset === -1) {
      return null;
    }

    return {
      endOffsetExclusive: commentEndOffset + 3
    };
  }

  let activeQuote: '"' | "'" | null = null;

  for (let index = tagStartOffset + 1; index < rawContent.length; index += 1) {
    const character = rawContent[index];

    if (activeQuote !== null) {
      if (character === activeQuote) {
        activeQuote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      continue;
    }

    if (character === ">") {
      const rawTag = rawContent.slice(tagStartOffset, index + 1);

      return {
        endOffsetExclusive: index + 1,
        tagName: extractHtmlTagName(rawTag)
      };
    }
  }

  return null;
}

function extractHtmlTagName(rawTag: string): string | undefined {
  let index = 1;

  if (rawTag.startsWith("</")) {
    index = 2;
  }

  while (index < rawTag.length && /\s/.test(rawTag[index] ?? "")) {
    index += 1;
  }

  if (rawTag[index] === "!" || rawTag[index] === "?") {
    return undefined;
  }

  const tagNameStart = index;

  while (index < rawTag.length && /[A-Za-z0-9:-]/.test(rawTag[index] ?? "")) {
    index += 1;
  }

  if (tagNameStart === index) {
    return undefined;
  }

  return rawTag.slice(tagNameStart, index).toLowerCase();
}

function findLiquidTokenEnd(
  rawContent: string,
  searchStartOffset: number,
  closingDelimiter: "}}" | "%}"
): number {
  let activeQuote: '"' | "'" | null = null;

  for (let index = searchStartOffset; index < rawContent.length; index += 1) {
    const character = rawContent[index];

    if (activeQuote !== null) {
      if (character === activeQuote) {
        activeQuote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      continue;
    }

    if (rawContent.startsWith(closingDelimiter, index)) {
      return index + closingDelimiter.length;
    }
  }

  return -1;
}

function pushTextToken(
  tokens: StructuralToken[],
  rawContent: string,
  startOffset: number,
  endOffsetExclusive: number
): void {
  if (startOffset >= endOffsetExclusive) {
    return;
  }

  tokens.push({
    kind: "text",
    startOffset,
    endOffsetExclusive,
    value: rawContent.slice(startOffset, endOffsetExclusive)
  });
}

function isTranslatableCandidate(plainText: string): boolean {
  const trimmed = plainText.trim();

  if (trimmed.length === 0) {
    return false;
  }

  if (isStandaloneUrl(trimmed)) {
    return false;
  }

  const decoded = decodeHtmlCharacterReferences(trimmed);

  return /[\p{L}\p{N}]/u.test(decoded);
}

function decodeHtmlCharacterReferences(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
      const codePoint = parseInt(hex, 16);

      return codePoint > 0 && codePoint <= 0x10FFFF
        ? String.fromCodePoint(codePoint)
        : match;
    })
    .replace(/&#(\d+);/g, (match, dec: string) => {
      const codePoint = parseInt(dec, 10);

      return codePoint > 0 && codePoint <= 0x10FFFF
        ? String.fromCodePoint(codePoint)
        : match;
    });
}

function isStandaloneUrl(value: string): boolean {
  if (/\s/.test(value)) {
    return false;
  }

  try {
    const parsedUrl = new URL(value);

    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
}

function shouldKeepLiquidTagWithinTranslation(liquidTag: string): boolean {
  const liquidTagName = getLiquidTagName(liquidTag);

  if (liquidTagName === null) {
    return false;
  }

  return INLINE_LIQUID_TAG_NAMES.has(liquidTagName);
}

function getLiquidTagName(liquidTag: string): string | null {
  const normalizedTagBody = liquidTag
    .slice(2, -2)
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, "");

  if (normalizedTagBody.length === 0) {
    return null;
  }

  const liquidTagName = normalizedTagBody
    .split(/\s+/, 1)[0]
    ?.toLowerCase();

  return liquidTagName === undefined || liquidTagName.length === 0
    ? null
    : liquidTagName;
}

function createTranslationBlock(entryId: string, sourceText: string): string {
  return `{% translation ${entryId} %}${sourceText}{% endtranslation %}`;
}

function createChecksum(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function createDeterministicIdentifier(prefix: string, seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function createValidationError(
  error: Omit<ValidationError, "severity"> & {
    readonly severity?: ValidationError["severity"];
  }
): ValidationError {
  return ValidationErrorSchema.parse({
    severity: error.severity ?? "error",
    ...error
  });
}
