import { describe, expect, it } from "vitest";

import { type TranslationRequest } from "@braze-ai-translator/schemas";

import {
  OpenAITranslationProvider,
  protectTemplatePlaceholders,
  restoreTemplatePlaceholders,
  type OpenAITranslationClient,
  type OpenAITranslationClientRequest
} from "./openaiTranslator.js";

const fixedNow = "2026-03-15T19:00:00.000Z";

class StubOpenAITranslationClient implements OpenAITranslationClient {
  readonly calls: OpenAITranslationClientRequest[] = [];

  constructor(
    private readonly translateImpl: (
      request: OpenAITranslationClientRequest
    ) => Promise<string> | string
  ) {}

  async translateText(
    request: OpenAITranslationClientRequest
  ): Promise<string> {
    this.calls.push(request);
    return this.translateImpl(request);
  }
}

function createTranslationRequest(): TranslationRequest {
  return {
    requestId: "request.openai.1",
    extractionId: "extract.email.hero",
    sourceLocale: "en-US",
    targetLocales: ["fr-FR", "es-ES"],
    entries: [
      {
        entryId: "tr_openai_entry_1",
        extractionId: "extract.email.hero",
        sourceLocale: "en-US",
        messageChannel: "email",
        contentFieldKey: "email.body_html",
        contentFieldType: "html",
        sourceText: "Hello {{ first_name | default: 'friend' }}!",
        sourceTextChecksum: "sha256:entry",
        sourceRange: {
          startOffset: 0,
          endOffsetExclusive: 43
        },
        surroundingTextBefore: "<p>",
        surroundingTextAfter: "</p>",
        preservedLiquidBlocks: ["{{ first_name | default: 'friend' }}"]
      }
    ],
    requestedAt: "2026-03-15T18:59:30.000Z"
  };
}

describe("OpenAI translation provider", () => {
  it("protects and restores liquid and handlebars placeholders", () => {
    const sourceText =
      "Hello {{ first_name }} {% if vip %}VIP{% endif %} {{{company}}}";
    const protectedText = protectTemplatePlaceholders(sourceText, {
      sourceEntryId: "tr_openai_entry_1"
    });

    expect(protectedText.validationErrors).toHaveLength(0);
    expect(protectedText.protectedText).toBe(
      "Hello __BRAZE_TOKEN_0000__ __BRAZE_TOKEN_0001__VIP__BRAZE_TOKEN_0002__ __BRAZE_TOKEN_0003__"
    );

    const restoredText = restoreTemplatePlaceholders(
      protectedText.protectedText,
      protectedText.placeholders,
      {
        sourceEntryId: "tr_openai_entry_1"
      }
    );

    expect(restoredText.validationErrors).toHaveLength(0);
    expect(restoredText.restoredText).toBe(sourceText);
  });

  it("maps translated output back to the original protected placeholders", async () => {
    const client = new StubOpenAITranslationClient((request) => {
      expect(request.protectedText).toContain("__BRAZE_TOKEN_0000__");
      expect(request.protectedText).not.toContain("{{ first_name");

      return "Bonjour __BRAZE_TOKEN_0000__ !";
    });
    const provider = new OpenAITranslationProvider({
      now: () => fixedNow,
      model: "gpt-5-mini",
      client
    });
    const request = createTranslationRequest();

    const response = await provider.translate({
      ...request,
      targetLocales: ["fr-FR"]
    });

    expect(response.responseStatus).toBe("success");
    expect(response.translations).toHaveLength(1);
    expect(response.translations[0]?.translatedText).toBe(
      "Bonjour {{ first_name | default: 'friend' }} !"
    );
    expect(client.calls[0]?.targetLocale).toBe("fr-FR");
  });

  it("translates each entry for every requested locale", async () => {
    const client = new StubOpenAITranslationClient((request) => {
      if (request.targetLocale === "fr-FR") {
        return "Bonjour __BRAZE_TOKEN_0000__ !";
      }

      return "Hola __BRAZE_TOKEN_0000__!";
    });
    const provider = new OpenAITranslationProvider({
      now: () => fixedNow,
      model: "gpt-5-mini",
      client
    });

    const response = await provider.translate(createTranslationRequest());

    expect(response.responseStatus).toBe("success");
    expect(response.translations).toHaveLength(2);
    expect(response.translations.map((translation) => translation.targetLocale)).toEqual([
      "fr-FR",
      "es-ES"
    ]);
    expect(response.translations[0]?.translatedText).toBe(
      "Bonjour {{ first_name | default: 'friend' }} !"
    );
    expect(response.translations[1]?.translatedText).toBe(
      "Hola {{ first_name | default: 'friend' }}!"
    );
  });

  it("fails closed when the model drops a protected token", async () => {
    const client = new StubOpenAITranslationClient(() => "Bonjour !");
    const provider = new OpenAITranslationProvider({
      now: () => fixedNow,
      model: "gpt-5-mini",
      client
    });
    const request = createTranslationRequest();

    const response = await provider.translate({
      ...request,
      targetLocales: ["fr-FR"]
    });

    expect(response.responseStatus).toBe("failed");
    expect(response.translations[0]?.translatedText).toBe(
      request.entries[0]?.sourceText
    );
    expect(response.translations[0]?.validationErrors[0]?.errorCode).toBe(
      "invalid_translation"
    );
  });
});
