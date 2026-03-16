import { describe, expect, it } from "vitest";

import {
  BrazeTemplatePushResultSchema,
  BrazeTemplateSourceDataSchema,
  type BrazeTemplatePushRequest,
  type BrazeTemplatePushResult,
  type BrazeTemplateSourceData,
  type TemplateTranslateRequest,
  type TranslationEntry,
  type ValidationError
} from "@braze-ai-translator/schemas";

import { MockTranslationProvider } from "../providers.js";
import type { BrazeTemplateClient } from "./brazeTemplate.js";
import {
  TemplateTranslationWorkflowProvider,
  detectMissingTemplateTranslations,
  mergeTemplateTranslations,
  normalizeBrazeTemplateEntries,
  summarizeTemplateTranslateRun
} from "./templateTranslation.js";

const fixedNow = "2026-03-15T19:00:00.000Z";

class StubBrazeTemplateClient implements BrazeTemplateClient {
  readonly pushRequests: BrazeTemplatePushRequest[] = [];

  constructor(
    private readonly sourceData: BrazeTemplateSourceData,
    private readonly pushImpl: (
      request: BrazeTemplatePushRequest
    ) => Promise<BrazeTemplatePushResult> | BrazeTemplatePushResult = (
      request
    ) =>
      BrazeTemplatePushResultSchema.parse({
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
      })
  ) {}

  async fetchTemplateSourceData(
    _request: TemplateTranslateRequest
  ): Promise<BrazeTemplateSourceData> {
    return this.sourceData;
  }

  async pushTranslations(
    request: BrazeTemplatePushRequest
  ): Promise<BrazeTemplatePushResult> {
    this.pushRequests.push(request);
    return this.pushImpl(request);
  }
}

function createTranslationEntries(): TranslationEntry[] {
  const sourceData = createBrazeTemplateSourceData();

  return normalizeBrazeTemplateEntries(sourceData);
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

describe("template translation workflow helpers", () => {
  it("detects missing translations per locale without over-translating", () => {
    const result = detectMissingTemplateTranslations({
      entries: createTranslationEntries(),
      sourceLocale: "en-US",
      targetLocales: ["fr-FR", "es-ES", "en-US"],
      existingTranslations: createBrazeTemplateSourceData().existingTranslations
    });

    expect(result.requestedTranslationCount).toBe(6);
    expect(result.existingTranslationCount).toBe(3);
    expect(result.batches).toEqual([
      {
        targetLocale: "fr-FR",
        entries: [createTranslationEntries()[1]]
      },
      {
        targetLocale: "es-ES",
        entries: createTranslationEntries()
      }
    ]);
  });

  it("merges new translations into the existing dataset by entry and locale", () => {
    const mergedTranslations = mergeTemplateTranslations(
      [
        ...createBrazeTemplateSourceData().existingTranslations,
        {
          entryId: "entry.hero.headline",
          targetLocale: "es-ES",
          translatedText: "",
          translatedTextChecksum: "sha256:empty",
          validationErrors: [
            {
              errorCode: "missing_translation",
              message: "Missing translation",
              severity: "error"
            } satisfies ValidationError
          ]
        }
      ],
      [
        {
          entryId: "entry.hero.headline",
          targetLocale: "es-ES",
          translatedText: "Hola amigo",
          translatedTextChecksum: "sha256:hola-amigo",
          validationErrors: []
        },
        {
          entryId: "entry.hero.cta",
          targetLocale: "fr-FR",
          translatedText: "Acheter maintenant",
          translatedTextChecksum: "sha256:acheter-maintenant",
          validationErrors: []
        }
      ]
    );

    expect(mergedTranslations).toHaveLength(3);
    expect(
      mergedTranslations.find(
        (translation) =>
          translation.entryId === "entry.hero.headline" &&
          translation.targetLocale === "es-ES"
      )?.translatedText
    ).toBe("Hola amigo");
    expect(
      mergedTranslations.find(
        (translation) =>
          translation.entryId === "entry.hero.cta" &&
          translation.targetLocale === "fr-FR"
      )?.translatedText
    ).toBe("Acheter maintenant");
  });

  it("builds the route summary shape for partial runs", () => {
    const result = summarizeTemplateTranslateRun({
      templateId: "template.email.hero",
      localesProcessed: ["fr-FR", "es-ES"],
      requestedTranslationCount: 4,
      completedTranslationCount: 3,
      newTranslationCount: 2,
      existingTranslationCount: 1,
      failedTranslationCount: 0,
      pushFailureCount: 1,
      errors: [
        {
          errorCode: "sync_failed",
          message: "One translation failed to sync back to Braze.",
          severity: "error",
          sourceEntryId: "entry.hero.cta"
        }
      ],
      completedAt: fixedNow
    });

    expect(result.resultStatus).toBe("partial");
    expect(result.newTranslations).toBe(2);
    expect(result.skipped).toEqual({
      existingTranslations: 1,
      failedTranslations: 0,
      pushFailures: 1
    });
  });
});

describe("TemplateTranslationWorkflowProvider", () => {
  it("translates and pushes only the missing template locale pairs", async () => {
    const client = new StubBrazeTemplateClient(createBrazeTemplateSourceData());
    const provider = new TemplateTranslationWorkflowProvider({
      now: () => fixedNow,
      translationProvider: new MockTranslationProvider({
        now: () => fixedNow
      }),
      brazeTemplateClient: client
    });
    const request: TemplateTranslateRequest = {
      templateId: "template.email.hero",
      targetLocales: ["fr-FR", "es-ES"]
    };

    const response = await provider.translateTemplate(request);

    expect(response.resultStatus).toBe("success");
    expect(response.newTranslations).toBe(3);
    expect(response.skipped.existingTranslations).toBe(1);
    expect(response.errors).toHaveLength(0);
    expect(client.pushRequests).toHaveLength(1);
    expect(client.pushRequests[0]?.newTranslations).toHaveLength(3);
    expect(client.pushRequests[0]?.mergedTranslations).toHaveLength(4);
  });

  it("fails cleanly when template extraction returns blocking validation errors", async () => {
    const client = new StubBrazeTemplateClient(
      BrazeTemplateSourceDataSchema.parse({
        templateId: "template.email.broken",
        extractionId: "extract.email.broken",
        sourceLocale: "en-US",
        entries: [],
        existingTranslations: [],
        validationErrors: [
          {
            errorCode: "invalid_liquid_syntax",
            message: "Unexpected Liquid closing delimiter.",
            severity: "error"
          }
        ],
        fetchedAt: fixedNow
      })
    );
    const provider = new TemplateTranslationWorkflowProvider({
      now: () => fixedNow,
      translationProvider: new MockTranslationProvider({
        now: () => fixedNow
      }),
      brazeTemplateClient: client
    });

    const response = await provider.translateTemplate({
      templateId: "template.email.broken",
      targetLocales: ["fr-FR"]
    });

    expect(response.resultStatus).toBe("failed");
    expect(response.errors).toHaveLength(1);
    expect(client.pushRequests).toHaveLength(0);
  });
});
