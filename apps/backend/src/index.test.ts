import { describe, expect, it } from "vitest";

import {
  type BrazeSyncRequest,
  type ExtractedContentPayload,
  type TranslationRequest
} from "@braze-ai-translator/schemas";

import { buildBackendApp } from "./index.js";
import { MockTranslationProvider } from "./providers.js";

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
    expect(body.transformedContent).toMatch(
      /^<p>\{\{content_blocks\.\$\{tr_[a-f0-9]{16}\}\}\}<\/p>$/
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
