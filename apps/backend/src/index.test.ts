import { describe, expect, it } from "vitest";

import {
  BrazeTemplatePushResultSchema,
  BrazeTemplateSourceDataSchema,
  type BrazeSyncRequest,
  type BrazeTemplatePushRequest,
  type BrazeTemplatePushResult,
  type BrazeTemplateSourceData,
  type CsvImportRequest,
  type ExtractedContentPayload,
  type TranslationRequest
} from "@braze-ai-translator/schemas";

import { buildBackendApp } from "./index.js";
import {
  MockTranslationProvider,
  TemplateTranslationWorkflowProvider,
  type BrazeTemplateClient
} from "./providers.js";

const fixedNow = "2026-03-15T19:00:00.000Z";

function createExtractedContentPayload(): ExtractedContentPayload {
  return {
    extractionId: "extract.email.hero",
    sourcePlatform: "braze",
    sourceWorkspaceId: "workspace.primary",
    sourceCampaignId: "campaign.spring.2026",
    sourceMessageId: "message.hero",
    sourceMessageVariantId: "variant.a",
    messageChannel: "email",
    contentFieldKey: "email.body_html",
    contentFieldType: "html",
    sourceLocale: "en-US",
    rawContent: "<p>Hello {{ first_name | default: 'friend' }}!</p>",
    contentChecksum: "sha256:input",
    detectedLiquid: true,
    translationEntries: [],
    validationErrors: [],
    extractedAt: "2026-03-15T18:59:00.000Z"
  };
}

function createTranslationRequest(): TranslationRequest {
  const extractedPayload = createExtractedContentPayload();

  return {
    requestId: "request.mock.1",
    extractionId: extractedPayload.extractionId,
    sourceLocale: extractedPayload.sourceLocale,
    targetLocales: ["fr-FR", "es-ES"],
    entries: [
      {
        entryId: "tr_abc123ef456789ab",
        extractionId: extractedPayload.extractionId,
        sourceLocale: extractedPayload.sourceLocale,
        messageChannel: extractedPayload.messageChannel,
        contentFieldKey: extractedPayload.contentFieldKey,
        contentFieldType: extractedPayload.contentFieldType,
        sourceText: "Hello {{ first_name | default: 'friend' }}!",
        sourceTextChecksum: "sha256:entry",
        sourceRange: {
          startOffset: 3,
          endOffsetExclusive: 46
        },
        surroundingTextBefore: "<p>",
        surroundingTextAfter: "</p>",
        preservedLiquidBlocks: ["{{ first_name | default: 'friend' }}"]
      }
    ],
    requestedAt: "2026-03-15T18:59:30.000Z"
  };
}

function createCsvImportRequest(
  csvContent: string
): CsvImportRequest {
  return {
    importId: "csv.import.1",
    requestId: "request.mock.1",
    csvContent,
    requestedAt: fixedNow
  };
}

class StubBrazeTemplateClient implements BrazeTemplateClient {
  readonly pushRequests: BrazeTemplatePushRequest[] = [];

  async fetchTemplateSourceData(
    _request: { templateId: string; targetLocales: string[] }
  ): Promise<BrazeTemplateSourceData> {
    return createBrazeTemplateSourceData();
  }

  async pushTranslations(
    request: BrazeTemplatePushRequest
  ): Promise<BrazeTemplatePushResult> {
    this.pushRequests.push(request);

    return BrazeTemplatePushResultSchema.parse({
      templateId: request.templateId,
      pushStatus: "success",
      pushedTranslationCount: request.newTranslations.length,
      results: request.newTranslations.map((translation) => ({
        entryId: translation.entryId,
        targetLocale: translation.targetLocale,
        syncStatus: "synced",
        message: "Stub Braze template push completed."
      })),
      validationErrors: [],
      completedAt: fixedNow
    });
  }
}

function createBrazeTemplateSourceData(): BrazeTemplateSourceData {
  return BrazeTemplateSourceDataSchema.parse({
    templateId: "template.email.hero",
    extractionId: "extract.email.hero",
    sourceLocale: "en-US",
    entries: [
      {
        entryId: "entry.hero.headline",
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
        preservedLiquidBlocks: []
      },
      {
        entryId: "entry.hero.cta",
        messageChannel: "email",
        contentFieldKey: "email.body_html",
        contentFieldType: "html",
        sourceText: "Shop now",
        sourceTextChecksum: "sha256:shop-now",
        sourceRange: {
          startOffset: 13,
          endOffsetExclusive: 21
        },
        surroundingTextBefore: "<p>",
        surroundingTextAfter: "</p>",
        preservedLiquidBlocks: []
      }
    ],
    existingTranslations: [
      {
        entryId: "entry.hero.headline",
        targetLocale: "fr-FR",
        translatedText: "Bonjour ami",
        translatedTextChecksum: "sha256:bonjour-ami",
        validationErrors: []
      }
    ],
    validationErrors: [],
    fetchedAt: "2026-03-15T18:58:00.000Z"
  });
}

describe("backend MVP API", () => {
  it("transforms extracted content through the local liquid engine", async () => {
    const app = buildBackendApp({
      now: () => fixedNow
    });

    const response = await app.inject({
      method: "POST",
      url: "/transform",
      payload: createExtractedContentPayload()
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.transformStatus).toBe("success");
    expect(body.translationEntries).toHaveLength(1);
    expect(body.translationEntries[0]?.entryId).toBe("item_1");
    expect(body.transformedContent).toBe(
      "<p>{% translation item_1 %}Hello {{ first_name | default: 'friend' }}!{% endtranslation %}</p>"
    );

    await app.close();
  });

  it("returns mocked translated entries for requested locales", async () => {
    const app = buildBackendApp({
      now: () => fixedNow
    });

    const response = await app.inject({
      method: "POST",
      url: "/translate/mock",
      payload: createTranslationRequest()
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.responseStatus).toBe("success");
    expect(body.translations).toHaveLength(2);
    expect(body.translations[0]?.translatedText).toContain("[mock:fr-FR]");

    await app.close();
  });

  it("translates entries through the configurable /translate provider", async () => {
    const app = buildBackendApp({
      now: () => fixedNow,
      providers: {
        translationProvider: new MockTranslationProvider({
          now: () => fixedNow
        })
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/translate",
      payload: createTranslationRequest()
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.responseStatus).toBe("success");
    expect(body.translations).toHaveLength(2);
    expect(body.translations[0]?.translatedText).toContain("[mock:fr-FR]");

    await app.close();
  });

  it("rejects canvas translate without required Braze headers", async () => {
    const app = buildBackendApp({
      now: () => fixedNow
    });

    const response = await app.inject({
      method: "POST",
      url: "/canvas/translate",
      payload: {
        canvasId: "abc-123-def"
      }
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();

    expect(body.message).toContain("X-Braze-Api-Key");

    await app.close();
  });

  it("translates a Braze template through the template workflow route", async () => {
    const brazeTemplateClient = new StubBrazeTemplateClient();
    const templateTranslationProvider = new TemplateTranslationWorkflowProvider({
      now: () => fixedNow,
      translationProvider: new MockTranslationProvider({
        now: () => fixedNow
      }),
      brazeTemplateClient
    });
    const app = buildBackendApp({
      now: () => fixedNow,
      providers: {
        templateTranslationProvider
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/template/translate",
      payload: {
        templateId: "template.email.hero",
        targetLocales: ["fr-FR", "es-ES"]
      }
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.resultStatus).toBe("success");
    expect(body.newTranslations).toBe(3);
    expect(body.skipped.existingTranslations).toBe(1);
    expect(brazeTemplateClient.pushRequests).toHaveLength(1);

    await app.close();
  });

  it("exports translation entries to the server CSV contract", async () => {
    const app = buildBackendApp({
      now: () => fixedNow
    });

    const response = await app.inject({
      method: "POST",
      url: "/csv/export",
      payload: createTranslationRequest()
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.exportStatus).toBe("success");
    expect(body.csvRowCount).toBe(2);
    expect(body.csvContent).toContain(
      "translation_id,source_locale,source_text,target_locale,translated_text,status"
    );
    expect(body.csvContent).toContain("tr_abc123ef456789ab");

    await app.close();
  });

  it("imports translated CSV rows into typed translation responses", async () => {
    const app = buildBackendApp({
      now: () => fixedNow
    });
    const csvContent = [
      "translation_id,source_locale,source_text,target_locale,translated_text,status",
      "tr_abc123ef456789ab,en-US,Hello {{ first_name | default: 'friend' }}!,fr-FR,Bonjour {{ first_name | default: 'friend' }}!,translated",
      "tr_abc123ef456789ab,en-US,Hello {{ first_name | default: 'friend' }}!,es-ES,Hola {{ first_name | default: 'friend' }}!,needs_review"
    ].join("\n");

    const response = await app.inject({
      method: "POST",
      url: "/csv/import",
      payload: createCsvImportRequest(csvContent)
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.importStatus).toBe("success");
    expect(body.acceptedTranslationCount).toBe(2);
    expect(body.translations[0]?.targetLocale).toBe("fr-FR");
    expect(body.translations[1]?.translatedText).toContain("Hola");

    await app.close();
  });

  it("returns a partial CSV import result when rows are missing translations", async () => {
    const app = buildBackendApp({
      now: () => fixedNow
    });
    const csvContent = [
      "translation_id,source_locale,source_text,target_locale,translated_text,status",
      "tr_abc123ef456789ab,en-US,Hello friend,fr-FR,Bonjour ami,translated",
      "tr_abc123ef456789ab,en-US,Hello friend,es-ES,,pending"
    ].join("\n");

    const response = await app.inject({
      method: "POST",
      url: "/csv/import",
      payload: createCsvImportRequest(csvContent)
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.importStatus).toBe("partial");
    expect(body.acceptedTranslationCount).toBe(1);
    expect(body.validationErrors[0]?.errorCode).toBe("missing_translation");

    await app.close();
  });

  it("returns a failed CSV import result for malformed CSV content", async () => {
    const app = buildBackendApp({
      now: () => fixedNow
    });

    const response = await app.inject({
      method: "POST",
      url: "/csv/import",
      payload: createCsvImportRequest(
        "source_locale,translation_id,source_text,target_locale,translated_text,status\n"
      )
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.importStatus).toBe("failed");
    expect(body.acceptedTranslationCount).toBe(0);
    expect(body.validationErrors[0]?.errorCode).toBe("invalid_input");

    await app.close();
  });

  it("simulates a Braze sync result for translated entries", async () => {
    const app = buildBackendApp({
      now: () => fixedNow
    });
    const translationResponse = await app.inject({
      method: "POST",
      url: "/translate/mock",
      payload: createTranslationRequest()
    });
    const syncPayload: BrazeSyncRequest = {
      syncId: "sync.mock.1",
      requestId: "request.mock.1",
      translations: translationResponse.json().translations,
      requestedAt: fixedNow
    };

    const response = await app.inject({
      method: "POST",
      url: "/braze/mock-sync",
      payload: syncPayload
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.syncStatus).toBe("success");
    expect(body.syncedEntryCount).toBe(2);
    expect(body.syncedTranslations[0]?.brazeContentBlockKey).toContain("cb.");

    await app.close();
  });

  it("returns a structured 400 error for invalid request bodies", async () => {
    const app = buildBackendApp({
      now: () => fixedNow
    });

    const response = await app.inject({
      method: "POST",
      url: "/transform",
      payload: {
        rawContent: 123
      }
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();

    expect(body.errorCode).toBe("invalid_request");
    expect(body.validationErrors.length).toBeGreaterThan(0);

    await app.close();
  });
});
