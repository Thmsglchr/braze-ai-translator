import { createHash } from "node:crypto";

import {
  BrazeSyncResultSchema,
  TransformResultSchema,
  TranslationResponseSchema,
  type BrazeSyncItem,
  type BrazeSyncRequest,
  type BrazeSyncResult,
  type ExtractedContentPayload,
  type TransformResult,
  type TranslationRequest,
  type TranslationResponse,
  type ValidationError
} from "@braze-ai-translator/schemas";
import { tagLiquidTemplate } from "@braze-ai-translator/liquid-engine";
import {
  LocalCsvProvider,
  type CsvProvider
} from "./providers/csv.js";
import {
  BrazeRestTemplateClient,
  TodoBrazeTemplateClient,
  type BrazeTemplateClient
} from "./providers/brazeTemplate.js";
import { OpenAITranslationProvider } from "./providers/openaiTranslator.js";
import {
  TemplateTranslationWorkflowProvider,
  type TemplateTranslationProvider
} from "./providers/templateTranslation.js";

export type { CsvProvider } from "./providers/csv.js";
export { LocalCsvProvider } from "./providers/csv.js";
export type { BrazeTemplateClient } from "./providers/brazeTemplate.js";
export {
  BrazeRestTemplateClient,
  TodoBrazeTemplateClient
} from "./providers/brazeTemplate.js";
export { OpenAITranslationProvider } from "./providers/openaiTranslator.js";
export type {
  DetectMissingTemplateTranslationsOptions,
  MissingTemplateTranslationBatch,
  MissingTemplateTranslationsResult,
  TemplateTranslationProvider,
  TemplateTranslationWorkflowProviderOptions
} from "./providers/templateTranslation.js";
export {
  detectMissingTemplateTranslations,
  mergeTemplateTranslations,
  normalizeBrazeTemplateEntries,
  summarizeTemplateTranslateRun,
  TemplateTranslationWorkflowProvider
} from "./providers/templateTranslation.js";

export interface TransformProvider {
  transform(payload: ExtractedContentPayload): Promise<TransformResult>;
}

export interface TranslationProvider {
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}

export interface BrazeSyncProvider {
  sync(request: BrazeSyncRequest): Promise<BrazeSyncResult>;
}

export interface BackendProviders {
  readonly transformProvider: TransformProvider;
  readonly translationProvider: TranslationProvider;
  readonly csvProvider: CsvProvider;
  readonly brazeSyncProvider: BrazeSyncProvider;
  readonly brazeTemplateClient: BrazeTemplateClient;
  readonly templateTranslationProvider: TemplateTranslationProvider;
}

export interface ProviderContext {
  readonly now: () => string;
}

export function createDefaultProviders(
  context: ProviderContext
): BackendProviders {
  const translationProvider = new OpenAITranslationProvider({
    now: context.now,
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL
  });
  const brazeTemplateClient = createBrazeTemplateClient(context);

  return {
    transformProvider: new LocalTransformProvider(context),
    translationProvider,
    csvProvider: new LocalCsvProvider(context),
    brazeSyncProvider: new MockBrazeSyncProvider(context),
    brazeTemplateClient,
    templateTranslationProvider: new TemplateTranslationWorkflowProvider({
      now: context.now,
      translationProvider,
      brazeTemplateClient
    })
  };
}

export class LocalTransformProvider implements TransformProvider {
  constructor(private readonly context: ProviderContext) {}

  async transform(payload: ExtractedContentPayload): Promise<TransformResult> {
    if (payload.validationErrors.length > 0) {
      return TransformResultSchema.parse({
        transformId: `transform:${payload.extractionId}`,
        extractionId: payload.extractionId,
        transformStatus: "failed",
        originalContent: payload.rawContent,
        transformedContent: null,
        contentChanged: false,
        appliedTranslationTagCount: 0,
        translationEntries: payload.translationEntries,
        validationErrors: payload.validationErrors,
        generatedAt: this.context.now()
      });
    }

    return tagLiquidTemplate({
      rawContent: payload.rawContent,
      extractionId: payload.extractionId,
      sourceLocale: payload.sourceLocale,
      messageChannel: payload.messageChannel,
      contentFieldKey: payload.contentFieldKey,
      contentFieldType: payload.contentFieldType,
      sourceWorkspaceId: payload.sourceWorkspaceId,
      sourceCampaignId: payload.sourceCampaignId,
      sourceCanvasId: payload.sourceCanvasId,
      sourceMessageId: payload.sourceMessageId,
      sourceMessageVariantId: payload.sourceMessageVariantId,
      extractedAt: payload.extractedAt,
      generatedAt: this.context.now()
    }).transformResult;
  }
}

export class MockTranslationProvider implements TranslationProvider {
  constructor(private readonly context: ProviderContext) {}

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const translations = request.targetLocales.flatMap((targetLocale) =>
      request.entries.map((entry) => {
        const translatedText = `${entry.sourceText} [mock:${targetLocale}]`;

        return {
          entryId: entry.entryId,
          targetLocale,
          translatedText,
          translatedTextChecksum: createChecksum(translatedText),
          validationErrors: [] satisfies ValidationError[]
        };
      })
    );

    return TranslationResponseSchema.parse({
      requestId: request.requestId,
      responseStatus: "success",
      translations,
      validationErrors: [],
      completedAt: this.context.now()
    });
  }
}

export class MockBrazeSyncProvider implements BrazeSyncProvider {
  constructor(private readonly context: ProviderContext) {}

  async sync(request: BrazeSyncRequest): Promise<BrazeSyncResult> {
    const syncedTranslations = request.translations.map((translation) =>
      this.createSyncItem(translation)
    );
    const syncedEntryCount = syncedTranslations.filter(
      (translation) => translation.syncStatus === "synced"
    ).length;
    const validationErrors = request.translations.flatMap(
      (translation) => translation.validationErrors
    );

    return BrazeSyncResultSchema.parse({
      syncId: request.syncId,
      requestId: request.requestId,
      syncStatus: getBrazeSyncStatus(
        syncedEntryCount,
        syncedTranslations.length
      ),
      syncedEntryCount,
      syncedTranslations,
      validationErrors,
      completedAt: this.context.now()
    });
  }

  private createSyncItem(translation: BrazeSyncRequest["translations"][number]): BrazeSyncItem {
    if (translation.validationErrors.length > 0) {
      return {
        entryId: translation.entryId,
        targetLocale: translation.targetLocale,
        brazeContentBlockKey: createBrazeContentBlockKey(
          translation.entryId,
          translation.targetLocale
        ),
        syncStatus: "failed",
        message: "Skipped because the translated entry contains validation errors."
      };
    }

    return {
      entryId: translation.entryId,
      targetLocale: translation.targetLocale,
      brazeContentBlockKey: createBrazeContentBlockKey(
        translation.entryId,
        translation.targetLocale
      ),
      syncStatus: "synced",
      message: "Mock Braze sync completed."
    };
  }
}

function createBrazeTemplateClient(
  context: ProviderContext
): BrazeTemplateClient {
  const apiKey = process.env.BRAZE_REST_API_KEY;
  const restApiBaseUrl = process.env.BRAZE_REST_API_URL;

  if (
    apiKey !== undefined &&
    apiKey.length > 0 &&
    restApiBaseUrl !== undefined &&
    restApiBaseUrl.length > 0
  ) {
    return new BrazeRestTemplateClient({
      now: context.now,
      apiKey,
      restApiBaseUrl,
      sourceLocale: process.env.BRAZE_SOURCE_LOCALE
    });
  }

  return new TodoBrazeTemplateClient({ now: context.now });
}

function getBrazeSyncStatus(
  syncedEntryCount: number,
  totalEntryCount: number
): BrazeSyncResult["syncStatus"] {
  if (syncedEntryCount === totalEntryCount) {
    return "success";
  }

  if (syncedEntryCount === 0) {
    return "failed";
  }

  return "partial";
}

function createBrazeContentBlockKey(
  entryId: string,
  targetLocale: string
): string {
  return `cb.${entryId}.${targetLocale}`;
}

function createChecksum(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
