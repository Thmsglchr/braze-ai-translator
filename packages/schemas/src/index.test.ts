import { describe, expect, it } from "vitest";

import {
  ApiErrorResponseSchema,
  BrazeTemplatePushRequestSchema,
  BrazeTemplatePushResultSchema,
  BrazeTemplateSourceDataSchema,
  BrazeSyncRequestSchema,
  BrazeSyncResultSchema,
  CsvExportResponseSchema,
  CsvImportRequestSchema,
  CsvImportResponseSchema,
  ExtractedContentPayloadSchema,
  TemplateTranslateRequestSchema,
  TemplateTranslateResponseSchema,
  TemplateTranslationRequestSchema,
  TemplateTranslationResultSchema,
  TransformResultSchema,
  TranslationCsvRowSchema,
  TranslationRequestSchema,
  TranslationResponseSchema,
  TranslationSummarySchema,
  type ApiErrorResponse,
  type BrazeTemplatePushRequest,
  type BrazeTemplatePushResult,
  type BrazeTemplateSourceData,
  type BrazeSyncRequest,
  type BrazeSyncResult,
  type CsvImportRequest,
  type CsvImportResponse,
  type ExtractedContentPayload,
  type TranslationEntry,
  type TranslationCsvRow,
  type TranslationSummary,
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

const sampleCsvRow: TranslationCsvRow = {
  translation_id: sampleEntry.entryId,
  source_locale: "en-US",
  source_text: "Hello friend",
  target_locale: "fr-FR",
  translated_text: "Bonjour ami",
  status: "translated"
};

const sampleCsvImportRequest: CsvImportRequest = {
  importId: "csv.import.1",
  requestId: "request.3",
  csvContent:
    "translation_id,source_locale,source_text,target_locale,translated_text,status\nentry.hero.headline,en-US,Hello friend,fr-FR,Bonjour ami,translated\n",
  requestedAt: "2026-03-15T18:35:00.000Z"
};

const sampleCsvImportResponse: CsvImportResponse = {
  importId: "csv.import.1",
  requestId: "request.3",
  importStatus: "success",
  parsedRowCount: 1,
  acceptedTranslationCount: 1,
  translations: [
    {
      entryId: sampleEntry.entryId,
      targetLocale: "fr-FR",
      translatedText: "Bonjour ami",
      translatedTextChecksum: "sha256:bonjour-ami",
      validationErrors: []
    }
  ],
  validationErrors: [],
  completedAt: "2026-03-15T18:36:00.000Z"
};

const sampleTranslationSummary: TranslationSummary = {
  entryCount: 1,
  targetLocaleCount: 2,
  requestedTranslationCount: 2,
  completedTranslationCount: 1,
  skippedTranslationCount: 1,
  failedTranslationCount: 0
};

const sampleBrazeTemplateSourceData: BrazeTemplateSourceData = {
  templateId: "template.email.hero",
  extractionId: "extract.email.hero",
  sourceLocale: "en-US",
  entries: [
    {
      entryId: sampleEntry.entryId,
      messageChannel: sampleEntry.messageChannel,
      contentFieldKey: sampleEntry.contentFieldKey,
      contentFieldType: sampleEntry.contentFieldType,
      sourceText: sampleEntry.sourceText,
      sourceTextChecksum: sampleEntry.sourceTextChecksum,
      sourceRange: sampleEntry.sourceRange,
      surroundingTextBefore: sampleEntry.surroundingTextBefore,
      surroundingTextAfter: sampleEntry.surroundingTextAfter,
      preservedLiquidBlocks: sampleEntry.preservedLiquidBlocks
    }
  ],
  existingTranslations: [
    {
      entryId: sampleEntry.entryId,
      targetLocale: "fr-FR",
      translatedText: "Bonjour ami",
      translatedTextChecksum: "sha256:bonjour-ami",
      validationErrors: []
    }
  ],
  validationErrors: [],
  fetchedAt: "2026-03-15T18:33:00.000Z"
};

const sampleBrazeTemplatePushRequest: BrazeTemplatePushRequest = {
  templateId: "template.email.hero",
  newTranslations: [
    {
      entryId: sampleEntry.entryId,
      targetLocale: "es-ES",
      translatedText: "Hola amigo",
      translatedTextChecksum: "sha256:hola-amigo",
      validationErrors: []
    }
  ],
  mergedTranslations: [
    sampleBrazeTemplateSourceData.existingTranslations[0]!,
    {
      entryId: sampleEntry.entryId,
      targetLocale: "es-ES",
      translatedText: "Hola amigo",
      translatedTextChecksum: "sha256:hola-amigo",
      validationErrors: []
    }
  ],
  requestedAt: "2026-03-15T18:34:00.000Z"
};

const sampleBrazeTemplatePushResult: BrazeTemplatePushResult = {
  templateId: "template.email.hero",
  pushStatus: "success",
  pushedTranslationCount: 1,
  results: [
    {
      entryId: sampleEntry.entryId,
      targetLocale: "es-ES",
      syncStatus: "synced",
      message: "Mock Braze template push completed."
    }
  ],
  validationErrors: [],
  completedAt: "2026-03-15T18:35:00.000Z"
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

  it("parses a template translation workflow request", () => {
    const result = TemplateTranslationRequestSchema.parse({
      requestId: "template-request.1",
      sourceWorkspaceId: "workspace.primary",
      templateId: "template.email.hero",
      sourceLocale: "en-US",
      targetLocales: ["fr-FR", "es-ES"],
      requestedAt: "2026-03-15T18:33:00.000Z"
    });

    expect(result.templateId).toBe("template.email.hero");
    expect(result.targetLocales).toHaveLength(2);
  });

  it("parses a template translation workflow result", () => {
    const result = TemplateTranslationResultSchema.parse({
      requestId: "template-request.1",
      sourceWorkspaceId: "workspace.primary",
      templateId: "template.email.hero",
      sourceLocale: "en-US",
      targetLocales: ["fr-FR", "es-ES"],
      resultStatus: "partial",
      translationEntries: [sampleEntry],
      translations: [
        {
          entryId: sampleEntry.entryId,
          targetLocale: "fr-FR",
          translatedText: "Bonjour ami",
          translatedTextChecksum: "sha256:bonjour-ami",
          validationErrors: []
        }
      ],
      summary: sampleTranslationSummary,
      validationErrors: [],
      completedAt: "2026-03-15T18:34:00.000Z"
    });

    expect(result.summary.requestedTranslationCount).toBe(2);
    expect(result.translations).toHaveLength(1);
  });

  it("parses a template translate route request", () => {
    const result = TemplateTranslateRequestSchema.parse({
      templateId: "template.email.hero",
      targetLocales: ["fr-FR", "es-ES"]
    });

    expect(result.templateId).toBe("template.email.hero");
    expect(result.targetLocales).toEqual(["fr-FR", "es-ES"]);
  });

  it("parses Braze template source and push contracts", () => {
    const sourceData = BrazeTemplateSourceDataSchema.parse(
      sampleBrazeTemplateSourceData
    );
    const pushRequest = BrazeTemplatePushRequestSchema.parse(
      sampleBrazeTemplatePushRequest
    );
    const pushResult = BrazeTemplatePushResultSchema.parse(
      sampleBrazeTemplatePushResult
    );

    expect(sourceData.existingTranslations).toHaveLength(1);
    expect(pushRequest.newTranslations).toHaveLength(1);
    expect(pushResult.pushedTranslationCount).toBe(1);
  });

  it("allows template source data with no entries when extraction failed with a blocking error", () => {
    const result = BrazeTemplateSourceDataSchema.parse({
      ...sampleBrazeTemplateSourceData,
      entries: [],
      validationErrors: [
        {
          errorCode: "invalid_liquid_syntax",
          message: "Unexpected Liquid closing delimiter.",
          severity: "error"
        }
      ]
    });

    expect(result.entries).toEqual([]);
    expect(result.validationErrors).toHaveLength(1);
  });

  it("rejects empty template source data when there is no blocking validation error", () => {
    const result = BrazeTemplateSourceDataSchema.safeParse({
      ...sampleBrazeTemplateSourceData,
      entries: [],
      validationErrors: []
    });

    expect(result.success).toBe(false);
  });

  it("parses a template translate route response summary", () => {
    const result = TemplateTranslateResponseSchema.parse({
      templateId: "template.email.hero",
      resultStatus: "partial",
      localesProcessed: ["fr-FR", "es-ES"],
      newTranslations: 1,
      skipped: {
        existingTranslations: 1,
        failedTranslations: 0,
        pushFailures: 1
      },
      errors: [
        {
          errorCode: "sync_failed",
          message: "One translation failed to sync back to Braze.",
          severity: "error",
          sourceEntryId: sampleEntry.entryId
        }
      ],
      completedAt: "2026-03-15T18:36:00.000Z"
    });

    expect(result.skipped.pushFailures).toBe(1);
    expect(result.errors[0]?.errorCode).toBe("sync_failed");
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

  it("parses CSV export and import contracts", () => {
    const exportResult = CsvExportResponseSchema.parse({
      requestId: "request.4",
      exportStatus: "success",
      csvContent:
        "translation_id,source_locale,source_text,target_locale,translated_text,status\nentry.hero.headline,en-US,Hello friend,fr-FR,,pending\n",
      csvRowCount: 1,
      validationErrors: [],
      completedAt: "2026-03-15T18:34:00.000Z"
    });
    const importRequest = CsvImportRequestSchema.parse(sampleCsvImportRequest);
    const importResult = CsvImportResponseSchema.parse(sampleCsvImportResponse);

    expect(exportResult.csvRowCount).toBe(1);
    expect(importRequest.importId).toBe("csv.import.1");
    expect(importResult.acceptedTranslationCount).toBe(1);
  });

  it("parses the shared translation CSV row contract", () => {
    const result = TranslationCsvRowSchema.parse(sampleCsvRow);

    expect(result.status).toBe("translated");
  });

  it("rejects inconsistent successful CSV import responses", () => {
    const result = CsvImportResponseSchema.safeParse({
      ...sampleCsvImportResponse,
      importStatus: "success",
      acceptedTranslationCount: 0
    });

    expect(result.success).toBe(false);
  });

  it("rejects inconsistent translation summaries", () => {
    const result = TranslationSummarySchema.safeParse({
      ...sampleTranslationSummary,
      requestedTranslationCount: 2,
      completedTranslationCount: 2,
      skippedTranslationCount: 1
    });

    expect(result.success).toBe(false);
  });

  it("rejects template translation results with out-of-scope locales", () => {
    const result = TemplateTranslationResultSchema.safeParse({
      requestId: "template-request.2",
      templateId: "template.email.hero",
      sourceLocale: "en-US",
      targetLocales: ["fr-FR"],
      resultStatus: "partial",
      translationEntries: [sampleEntry],
      translations: [
        {
          entryId: sampleEntry.entryId,
          targetLocale: "es-ES",
          translatedText: "Hola amigo",
          translatedTextChecksum: "sha256:hola-amigo",
          validationErrors: []
        }
      ],
      summary: {
        entryCount: 1,
        targetLocaleCount: 1,
        requestedTranslationCount: 1,
        completedTranslationCount: 1,
        skippedTranslationCount: 0,
        failedTranslationCount: 0
      },
      validationErrors: [],
      completedAt: "2026-03-15T18:37:00.000Z"
    });

    expect(result.success).toBe(false);
  });
});
