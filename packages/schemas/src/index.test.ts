import { describe, expect, it } from "vitest";

import {
  ApiErrorResponseSchema,
  BrazeSyncRequestSchema,
  BrazeSyncResultSchema,
  ExtractedContentPayloadSchema,
  TransformResultSchema,
  TranslationRequestSchema,
  TranslationResponseSchema,
  type ApiErrorResponse,
  type BrazeSyncRequest,
  type BrazeSyncResult,
  type ExtractedContentPayload,
  type TranslationEntry,
  type ValidationError
} from "./index.js";

const sampleValidationError: ValidationError = {
  errorCode: "invalid_translation",
  message: "Placeholders must be preserved exactly.",
  severity: "error",
  fieldPathSegments: ["translations", 0, "translatedText"],
  sourceEntryId: "entry.hero.headline",
  sourceRange: {
    startOffset: 0,
    endOffsetExclusive: 12
  }
};

const sampleEntry: TranslationEntry = {
  entryId: "entry.hero.headline",
  extractionId: "extract.email.hero",
  sourceLocale: "en-US",
  messageChannel: "email",
  contentFieldKey: "email.body_html",
  contentFieldType: "html",
  sourceText: "Hello friend",
  sourceTextChecksum: "sha256:hello-friend",
  sourceRange: {
    startOffset: 0,
    endOffsetExclusive: 12
  },
  surroundingTextBefore: "<p>",
  surroundingTextAfter: "</p>",
  preservedLiquidBlocks: ["{{ first_name | default: 'friend' }}"]
};

const samplePayload: ExtractedContentPayload = {
  extractionId: "extract.email.hero",
  sourcePlatform: "braze",
  sourceWorkspaceId: "workspace.primary",
  sourceCampaignId: "campaign.launch.2026",
  sourceMessageId: "message.email.hero",
  sourceMessageVariantId: "variant.a",
  messageChannel: "email",
  contentFieldKey: "email.body_html",
  contentFieldType: "html",
  sourceLocale: "en-US",
  rawContent: "<p>Hello {{ first_name | default: 'friend' }}</p>",
  contentChecksum: "sha256:content",
  detectedLiquid: true,
  translationEntries: [sampleEntry],
  validationErrors: [],
  extractedAt: "2026-03-15T18:30:00.000Z"
};

const sampleSyncRequest: BrazeSyncRequest = {
  syncId: "sync.1",
  requestId: "request.3",
  translations: [
    {
      entryId: sampleEntry.entryId,
      targetLocale: "fr-FR",
      translatedText: "Bonjour ami",
      translatedTextChecksum: "sha256:bonjour-ami",
      validationErrors: []
    }
  ],
  requestedAt: "2026-03-15T18:40:00.000Z"
};

const sampleSyncResult: BrazeSyncResult = {
  syncId: "sync.1",
  requestId: "request.3",
  syncStatus: "success",
  syncedEntryCount: 1,
  syncedTranslations: [
    {
      entryId: sampleEntry.entryId,
      targetLocale: "fr-FR",
      brazeContentBlockKey: "tr_abc123ef456789ab",
      syncStatus: "synced",
      message: "Mock sync completed."
    }
  ],
  validationErrors: [],
  completedAt: "2026-03-15T18:41:00.000Z"
};

const sampleApiError: ApiErrorResponse = {
  errorCode: "invalid_request",
  message: "Request body did not match the expected contract.",
  validationErrors: [sampleValidationError]
};

describe("schema contracts", () => {
  it("parses a valid extracted content payload", () => {
    const result = ExtractedContentPayloadSchema.parse(samplePayload);

    expect(result.translationEntries).toHaveLength(1);
    expect(result.translationEntries[0]?.entryId).toBe("entry.hero.headline");
  });

  it("rejects duplicate translation entry ids inside an extracted payload", () => {
    const result = ExtractedContentPayloadSchema.safeParse({
      ...samplePayload,
      translationEntries: [
        sampleEntry,
        {
          ...sampleEntry,
          sourceRange: {
            startOffset: 20,
            endOffsetExclusive: 32
          }
        }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid text ranges for translation entries", () => {
    const result = TranslationRequestSchema.safeParse({
      requestId: "request.1",
      extractionId: samplePayload.extractionId,
      sourceLocale: samplePayload.sourceLocale,
      targetLocales: ["fr-FR"],
      entries: [
        {
          ...sampleEntry,
          sourceRange: {
            startOffset: 10,
            endOffsetExclusive: 10
          }
        }
      ],
      requestedAt: "2026-03-15T18:31:00.000Z"
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate target locales in a translation request", () => {
    const result = TranslationRequestSchema.safeParse({
      requestId: "request.2",
      extractionId: samplePayload.extractionId,
      sourceLocale: samplePayload.sourceLocale,
      targetLocales: ["fr-FR", "fr-FR"],
      entries: [sampleEntry],
      requestedAt: "2026-03-15T18:31:00.000Z"
    });

    expect(result.success).toBe(false);
  });

  it("rejects inconsistent successful transform results", () => {
    const result = TransformResultSchema.safeParse({
      transformId: "transform.1",
      extractionId: samplePayload.extractionId,
      transformStatus: "success",
      originalContent: samplePayload.rawContent,
      transformedContent: null,
      contentChanged: true,
      appliedTranslationTagCount: 1,
      translationEntries: [sampleEntry],
      validationErrors: [],
      generatedAt: "2026-03-15T18:32:00.000Z"
    });

    expect(result.success).toBe(false);
  });

  it("parses a future translation response contract", () => {
    const result = TranslationResponseSchema.parse({
      requestId: "request.3",
      responseStatus: "partial",
      translations: [
        {
          entryId: sampleEntry.entryId,
          targetLocale: "fr-FR",
          translatedText: "Bonjour ami",
          translatedTextChecksum: "sha256:bonjour-ami",
          validationErrors: []
        },
        {
          entryId: "entry.footer.cta",
          targetLocale: "fr-FR",
          translatedText: "",
          translatedTextChecksum: "sha256:empty-string",
          validationErrors: [sampleValidationError]
        }
      ],
      validationErrors: [],
      completedAt: "2026-03-15T18:33:00.000Z"
    });

    expect(result.responseStatus).toBe("partial");
    expect(result.translations[1]?.validationErrors).toHaveLength(1);
  });

  it("parses Braze mock sync contracts", () => {
    expect(BrazeSyncRequestSchema.parse(sampleSyncRequest).translations).toHaveLength(
      1
    );
    expect(BrazeSyncResultSchema.parse(sampleSyncResult).syncedEntryCount).toBe(
      1
    );
  });

  it("rejects duplicate translation pairs in a Braze mock sync request", () => {
    const result = BrazeSyncRequestSchema.safeParse({
      ...sampleSyncRequest,
      translations: [
        sampleSyncRequest.translations[0],
        sampleSyncRequest.translations[0]
      ]
    });

    expect(result.success).toBe(false);
  });

  it("parses API error responses", () => {
    const result = ApiErrorResponseSchema.parse(sampleApiError);

    expect(result.errorCode).toBe("invalid_request");
    expect(result.validationErrors).toHaveLength(1);
  });
});
