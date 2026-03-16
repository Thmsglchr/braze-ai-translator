import { describe, expect, it } from "vitest";

import type { TranslationRequest, TranslationResponse } from "@braze-ai-translator/schemas";

import type { TranslationProvider } from "../providers.js";
import type {
  BrazeCanvasClient,
  CanvasDetailsResponse,
  StepTranslationsResponse
} from "./brazeCanvas.js";
import { CanvasTranslationWorkflowProvider } from "./canvasTranslation.js";

const fixedNow = "2026-03-16T07:30:00.000Z";

class StubTranslationProvider implements TranslationProvider {
  readonly requests: TranslationRequest[] = [];

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    this.requests.push(request);

    return {
      requestId: request.requestId,
      responseStatus: "success",
      translations: request.entries.map((entry) => ({
        entryId: entry.entryId,
        targetLocale: request.targetLocales[0] ?? "fr-FR",
        translatedText: `translated:${entry.sourceText}`,
        translatedTextChecksum: "sha256:translated",
        validationErrors: []
      })),
      validationErrors: [],
      completedAt: fixedNow
    };
  }
}

class StubBrazeCanvasClient {
  readonly putCalls: Array<{
    readonly workflowId: string;
    readonly stepId: string;
    readonly messageVariationId: string;
    readonly localeId: string;
    readonly translationMap: Record<string, string>;
  }> = [];

  async getCanvasDetails(_canvasId: string): Promise<CanvasDetailsResponse> {
    return {
      name: "Lifecycle Canvas",
      description: "",
      draft: false,
      archived: false,
      steps: [
        {
          stepId: "step.welcome",
          stepName: "Welcome",
          type: "message",
          channels: ["email"],
          messages: [
            {
              messageVariationId: "variation.email",
              channel: "email",
              name: "Email A",
              hasTranslatableContent: true
            }
          ]
        }
      ]
    };
  }

  async getStepTranslations(
    _workflowId: string,
    _stepId: string,
    _messageVariationId: string
  ): Promise<StepTranslationsResponse> {
    return {
      translations: [
        {
          translationMap: {},
          locale: {
            uuid: "locale.uuid.fr",
            name: "French (France)",
            country: "FR",
            language: "fr",
            localeKey: "fr-FR"
          }
        }
      ]
    };
  }

  async getStepSourceTranslations(
    _workflowId: string,
    _stepId: string,
    _messageVariationId: string
  ): Promise<Record<string, string>> {
    return {
      item_1: "Hello friend"
    };
  }

  async putStepTranslation(
    workflowId: string,
    stepId: string,
    messageVariationId: string,
    localeId: string,
    translationMap: Record<string, string>
  ): Promise<void> {
    this.putCalls.push({
      workflowId,
      stepId,
      messageVariationId,
      localeId,
      translationMap
    });
  }
}

describe("CanvasTranslationWorkflowProvider", () => {
  it("uses the configured source locale and Braze locale keys when translating", async () => {
    const translationProvider = new StubTranslationProvider();
    const canvasClient = new StubBrazeCanvasClient();
    const provider = new CanvasTranslationWorkflowProvider({
      now: () => fixedNow,
      translationProvider,
      canvasClient: canvasClient as unknown as BrazeCanvasClient,
      sourceLocale: "fr-FR"
    });

    const result = await provider.translateCanvas("canvas.welcome");

    expect(result.resultStatus).toBe("success");
    expect(translationProvider.requests).toHaveLength(1);
    expect(translationProvider.requests[0]?.sourceLocale).toBe("fr-FR");
    expect(translationProvider.requests[0]?.targetLocales).toEqual(["fr-FR"]);
    expect(translationProvider.requests[0]?.entries[0]?.sourceLocale).toBe(
      "fr-FR"
    );
    expect(canvasClient.putCalls).toHaveLength(1);
    expect(canvasClient.putCalls[0]?.localeId).toBe("locale.uuid.fr");
    expect(canvasClient.putCalls[0]?.translationMap).toEqual({
      item_1: "translated:Hello friend"
    });
  });
});
