import { createHash } from "node:crypto";

import type {
  CanvasTranslateResponse,
  CanvasStepResult,
  TranslationRequest,
  TranslationEntry
} from "@braze-ai-translator/schemas";

import type { TranslationProvider } from "../providers.js";
import type {
  BrazeCanvasClient,
  CanvasStep,
  CanvasMessageVariation,
  TranslationLocale
} from "./brazeCanvas.js";

export interface CanvasTranslationWorkflowOptions {
  readonly now: () => string;
  readonly translationProvider: TranslationProvider;
  readonly canvasClient: BrazeCanvasClient;
  readonly sourceLocale?: string;
}

export interface CanvasTranslationProvider {
  translateCanvas(canvasId: string): Promise<CanvasTranslateResponse>;
}

export class CanvasTranslationWorkflowProvider
  implements CanvasTranslationProvider
{
  private readonly now: () => string;
  private readonly translationProvider: TranslationProvider;
  private readonly canvasClient: BrazeCanvasClient;
  private readonly sourceLocale: string;

  constructor(options: CanvasTranslationWorkflowOptions) {
    this.now = options.now;
    this.translationProvider = options.translationProvider;
    this.canvasClient = options.canvasClient;
    this.sourceLocale = options.sourceLocale ?? "en";
  }

  async translateCanvas(canvasId: string): Promise<CanvasTranslateResponse> {
    const details = await this.canvasClient.getCanvasDetails(canvasId);
    const workflowId = details.workflowId || canvasId;
    const stepResults: CanvasStepResult[] = [];
    const globalErrors: string[] = [];
    let totalTranslationsPushed = 0;

    for (const step of details.steps) {
      for (const message of step.messages) {
        const result = await this.translateStepMessage(
          workflowId,
          step,
          message
        );
        stepResults.push(result);
        totalTranslationsPushed += result.translationsPushed;

        if (result.errors.length > 0) {
          globalErrors.push(
            ...result.errors.map(
              (e) =>
                `[${step.stepName}/${message.channel}] ${e}`
            )
          );
        }
      }
    }

    const stepsProcessed = new Set(
      stepResults
        .filter((r) => r.status !== "skipped")
        .map((r) => r.stepId)
    ).size;
    const hasSuccess = stepResults.some((r) => r.status === "success");
    const allSuccess = stepResults.every(
      (r) => r.status === "success" || r.status === "skipped"
    );
    const resultStatus =
      stepsProcessed === 0
        ? "failed"
        : allSuccess
          ? "success"
          : hasSuccess
            ? "partial"
            : "failed";

    return {
      canvasId,
      canvasName: details.name,
      resultStatus,
      stepsProcessed,
      totalTranslationsPushed,
      stepResults,
      errors: globalErrors,
      completedAt: this.now()
    };
  }

  private async translateStepMessage(
    workflowId: string,
    step: CanvasStep,
    message: CanvasMessageVariation
  ): Promise<CanvasStepResult> {
    const baseResult: Pick<
      CanvasStepResult,
      "stepId" | "stepName" | "messageVariationId" | "channel"
    > = {
      stepId: step.stepId,
      stepName: step.stepName,
      messageVariationId: message.messageVariationId,
      channel: message.channel
    };

    try {
      const sourceMap = await this.canvasClient.getStepSourceTranslations(
        workflowId,
        step.stepId,
        message.messageVariationId
      );

      if (Object.keys(sourceMap).length === 0) {
        return {
          ...baseResult,
          status: "skipped",
          localesTranslated: [],
          translationsPushed: 0,
          errors: ["No translation tags found in this message."]
        };
      }

      const translationsResponse =
        await this.canvasClient.getStepTranslations(
          workflowId,
          step.stepId,
          message.messageVariationId
        );

      const locales = translationsResponse.translations.map(
        (t) => t.locale
      );

      if (locales.length === 0) {
        return {
          ...baseResult,
          status: "skipped",
          localesTranslated: [],
          translationsPushed: 0,
          errors: ["No locales configured for this message."]
        };
      }

      const entries = buildTranslationEntries(
        sourceMap,
        message.channel,
        this.sourceLocale
      );
      const localesTranslated: string[] = [];
      let translationsPushed = 0;
      const errors: string[] = [];

      for (const locale of locales) {
        try {
          const translatedMap = await this.translateForLocale(
            entries,
            sourceMap,
            locale
          );

          await this.canvasClient.putStepTranslation(
            workflowId,
            step.stepId,
            message.messageVariationId,
            locale.uuid,
            translatedMap
          );

          localesTranslated.push(locale.name);
          translationsPushed += Object.keys(translatedMap).length;
        } catch (error: unknown) {
          const msg =
            error instanceof Error ? error.message : "Unknown error";
          errors.push(`Locale ${locale.name}: ${msg}`);
        }
      }

      const status =
        errors.length === 0
          ? "success"
          : localesTranslated.length > 0
            ? "partial"
            : "failed";

      return {
        ...baseResult,
        status,
        localesTranslated,
        translationsPushed,
        errors
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return {
        ...baseResult,
        status: "failed",
        localesTranslated: [],
        translationsPushed: 0,
        errors: [msg]
      };
    }
  }

  private async translateForLocale(
    entries: readonly TranslationEntry[],
    sourceMap: Record<string, string>,
    locale: TranslationLocale
  ): Promise<Record<string, string>> {
    const targetLocale = getCanvasTargetLocale(locale);
    const requestId = `canvas-translate-${targetLocale}-${Date.now()}`;

    const request: TranslationRequest = {
      requestId,
      extractionId: requestId,
      sourceLocale: this.sourceLocale,
      targetLocales: [targetLocale],
      entries: [...entries],
      requestedAt: this.now()
    };

    const response = await this.translationProvider.translate(request);

    const translatedMap: Record<string, string> = {};

    for (const translation of response.translations) {
      const brazeTagId = translation.entryId;
      if (sourceMap[brazeTagId] !== undefined) {
        translatedMap[brazeTagId] = translation.translatedText;
      }
    }

    return translatedMap;
  }
}

function buildTranslationEntries(
  sourceMap: Record<string, string>,
  channel: string,
  sourceLocale: string
): TranslationEntry[] {
  return Object.entries(sourceMap).map(([tagId, sourceText]) => ({
    entryId: tagId,
    extractionId: `canvas-extract-${tagId}`,
    sourceLocale,
    messageChannel: normalizeChannel(channel),
    contentFieldKey: "body",
    contentFieldType: "plain_text" as const,
    sourceText,
    sourceTextChecksum: `sha256:${createHash("sha256").update(sourceText).digest("hex")}`,
    sourceRange: { startOffset: 0, endOffsetExclusive: sourceText.length },
    surroundingTextBefore: "",
    surroundingTextAfter: "",
    preservedLiquidBlocks: []
  }));
}

function normalizeChannel(
  channel: string
): "email" | "push" | "in_app" | "content_card" | "sms" | "webhook" {
  const mapping: Record<string, "email" | "push" | "in_app" | "content_card" | "sms" | "webhook"> = {
    email: "email",
    ios_push: "push",
    android_push: "push",
    web_push: "push",
    kindle_push: "push",
    push: "push",
    "in-app_message": "in_app",
    in_app_message: "in_app",
    in_app: "in_app",
    content_card: "content_card",
    content_cards: "content_card",
    sms: "sms",
    webhook: "webhook",
    whatsapp: "sms"
  };

  return mapping[channel] ?? "email";
}

function getCanvasTargetLocale(locale: TranslationLocale): string {
  const normalizedLocaleKey = locale.localeKey.trim();

  if (normalizedLocaleKey.length > 0) {
    return normalizedLocaleKey;
  }

  return locale.name;
}
