import {
  BrazeTemplatePushResultSchema,
  BrazeTemplateSourceDataSchema,
  TemplateTranslateResponseSchema,
  ValidationErrorSchema,
  type BrazeTemplatePushResult,
  type BrazeTemplateSourceData,
  type TemplateTranslateRequest,
  type TemplateTranslateResponse,
  type TranslationEntry,
  type TranslationResponseEntry,
  type ValidationError
} from "@braze-ai-translator/schemas";

import type { TranslationProvider } from "../providers.js";
import type { BrazeTemplateClient } from "./brazeTemplate.js";

export interface TemplateTranslationProvider {
  translateTemplate(
    request: TemplateTranslateRequest
  ): Promise<TemplateTranslateResponse>;
}

export interface MissingTemplateTranslationBatch {
  readonly targetLocale: string;
  readonly entries: readonly TranslationEntry[];
}

export interface MissingTemplateTranslationsResult {
  readonly batches: readonly MissingTemplateTranslationBatch[];
  readonly existingTranslationCount: number;
  readonly requestedTranslationCount: number;
}

export interface DetectMissingTemplateTranslationsOptions {
  readonly entries: readonly TranslationEntry[];
  readonly sourceLocale: string;
  readonly targetLocales: readonly string[];
  readonly existingTranslations: readonly TranslationResponseEntry[];
}

export interface TemplateTranslationWorkflowProviderOptions {
  readonly now: () => string;
  readonly translationProvider: TranslationProvider;
  readonly brazeTemplateClient: BrazeTemplateClient;
}

interface TemplateTranslateSummaryOptions {
  readonly templateId: string;
  readonly localesProcessed: readonly string[];
  readonly requestedTranslationCount: number;
  readonly completedTranslationCount: number;
  readonly newTranslationCount: number;
  readonly existingTranslationCount: number;
  readonly failedTranslationCount: number;
  readonly pushFailureCount: number;
  readonly errors: readonly ValidationError[];
  readonly completedAt: string;
}

export class TemplateTranslationWorkflowProvider
  implements TemplateTranslationProvider
{
  constructor(
    private readonly options: TemplateTranslationWorkflowProviderOptions
  ) {}

  async translateTemplate(
    request: TemplateTranslateRequest
  ): Promise<TemplateTranslateResponse> {
    const sourceData = BrazeTemplateSourceDataSchema.parse(
      await this.options.brazeTemplateClient.fetchTemplateSourceData(request)
    );
    const translationEntries = normalizeBrazeTemplateEntries(sourceData);
    const requestedTranslationCount =
      translationEntries.length * request.targetLocales.length;

    if (hasBlockingValidationErrors(sourceData.validationErrors)) {
      return summarizeTemplateTranslateRun({
        templateId: request.templateId,
        localesProcessed: request.targetLocales,
        requestedTranslationCount,
        completedTranslationCount: 0,
        newTranslationCount: 0,
        existingTranslationCount: 0,
        failedTranslationCount: requestedTranslationCount,
        pushFailureCount: 0,
        errors: sourceData.validationErrors,
        completedAt: this.options.now()
      });
    }

    const missingTranslations = detectMissingTemplateTranslations({
      entries: translationEntries,
      sourceLocale: sourceData.sourceLocale,
      targetLocales: request.targetLocales,
      existingTranslations: sourceData.existingTranslations
    });
    const translationResponses = await Promise.all(
      missingTranslations.batches.map((batch, batchIndex) =>
        this.options.translationProvider.translate({
          requestId: createTemplateTranslationRequestId(
            request.templateId,
            batch.targetLocale,
            batchIndex,
            this.options.now()
          ),
          extractionId: sourceData.extractionId,
          sourceLocale: sourceData.sourceLocale,
          targetLocales: [batch.targetLocale],
          entries: [...batch.entries],
          requestedAt: this.options.now()
        })
      )
    );
    const generatedTranslations = translationResponses.flatMap(
      (response) => response.translations
    );
    const acceptedTranslations = generatedTranslations.filter(
      isSuccessfulTranslation
    );
    const failedTranslationCount =
      generatedTranslations.length - acceptedTranslations.length;
    const mergedTranslations = mergeTemplateTranslations(
      sourceData.existingTranslations,
      acceptedTranslations
    );
    let pushResult: BrazeTemplatePushResult | undefined;
    let pushError: Error | undefined;

    if (acceptedTranslations.length > 0) {
      try {
        pushResult = BrazeTemplatePushResultSchema.parse(
          await this.options.brazeTemplateClient.pushTranslations({
            templateId: request.templateId,
            newTranslations: acceptedTranslations,
            mergedTranslations,
            requestedAt: this.options.now()
          })
        );
      } catch (error) {
        pushError = error instanceof Error ? error : new Error(String(error));
      }
    }

    const pushFailureCount = pushError
      ? acceptedTranslations.length
      : (pushResult?.results.filter((result) => result.syncStatus !== "synced")
          .length ?? 0);
    const newTranslationCount = pushError
      ? 0
      : (pushResult?.pushedTranslationCount ?? 0);

    return summarizeTemplateTranslateRun({
      templateId: request.templateId,
      localesProcessed: request.targetLocales,
      requestedTranslationCount: missingTranslations.requestedTranslationCount,
      completedTranslationCount:
        missingTranslations.existingTranslationCount + newTranslationCount,
      newTranslationCount,
      existingTranslationCount: missingTranslations.existingTranslationCount,
      failedTranslationCount,
      pushFailureCount,
      errors: dedupeValidationErrors([
        ...sourceData.validationErrors,
        ...translationResponses.flatMap((response) => response.validationErrors),
        ...(pushResult?.validationErrors ?? []),
        ...createPushFailureValidationErrors(pushResult),
        ...(pushError
          ? [
              ValidationErrorSchema.parse({
                errorCode: "sync_failed",
                message: pushError.message,
                severity: "error"
              })
            ]
          : [])
      ]),
      completedAt: this.options.now()
    });
  }
}

export function normalizeBrazeTemplateEntries(
  sourceData: BrazeTemplateSourceData
): TranslationEntry[] {
  return sourceData.entries.map((entry) => ({
    entryId: entry.entryId,
    extractionId: sourceData.extractionId,
    sourceLocale: sourceData.sourceLocale,
    messageChannel: entry.messageChannel,
    contentFieldKey: entry.contentFieldKey,
    contentFieldType: entry.contentFieldType,
    sourceText: entry.sourceText,
    sourceTextChecksum: entry.sourceTextChecksum,
    sourceRange: entry.sourceRange,
    surroundingTextBefore: entry.surroundingTextBefore,
    surroundingTextAfter: entry.surroundingTextAfter,
    preservedLiquidBlocks: entry.preservedLiquidBlocks
  }));
}

export function detectMissingTemplateTranslations(
  options: DetectMissingTemplateTranslationsOptions
): MissingTemplateTranslationsResult {
  const existingTranslationKeys = new Set(
    options.existingTranslations
      .filter(isSuccessfulTranslation)
      .map((translation) =>
        createTranslationKey(translation.entryId, translation.targetLocale)
      )
  );
  let existingTranslationCount = 0;

  const batches = options.targetLocales.flatMap((targetLocale) => {
    if (targetLocale === options.sourceLocale) {
      existingTranslationCount += options.entries.length;
      return [];
    }

    const missingEntries = options.entries.filter(
      (entry) =>
        !existingTranslationKeys.has(
          createTranslationKey(entry.entryId, targetLocale)
        )
    );

    existingTranslationCount += options.entries.length - missingEntries.length;

    if (missingEntries.length === 0) {
      return [];
    }

    return [
      {
        targetLocale,
        entries: missingEntries
      } satisfies MissingTemplateTranslationBatch
    ];
  });

  return {
    batches,
    existingTranslationCount,
    requestedTranslationCount: options.entries.length * options.targetLocales.length
  };
}

export function mergeTemplateTranslations(
  existingTranslations: readonly TranslationResponseEntry[],
  newTranslations: readonly TranslationResponseEntry[]
): TranslationResponseEntry[] {
  const mergedTranslations = [...existingTranslations];

  newTranslations.forEach((translation) => {
    const existingIndex = mergedTranslations.findIndex(
      (existingTranslation) =>
        existingTranslation.entryId === translation.entryId &&
        existingTranslation.targetLocale === translation.targetLocale
    );

    if (existingIndex === -1) {
      mergedTranslations.push(translation);
      return;
    }

    mergedTranslations[existingIndex] = translation;
  });

  return mergedTranslations;
}

export function summarizeTemplateTranslateRun(
  options: TemplateTranslateSummaryOptions
): TemplateTranslateResponse {
  return TemplateTranslateResponseSchema.parse({
    templateId: options.templateId,
    resultStatus: getTemplateTranslateStatus(
      options.completedTranslationCount,
      options.requestedTranslationCount,
      options.errors
    ),
    localesProcessed: [...options.localesProcessed],
    newTranslations: options.newTranslationCount,
    skipped: {
      existingTranslations: options.existingTranslationCount,
      failedTranslations: options.failedTranslationCount,
      pushFailures: options.pushFailureCount
    },
    errors: [...options.errors],
    completedAt: options.completedAt
  });
}

function createPushFailureValidationErrors(
  pushResult: BrazeTemplatePushResult | undefined
): ValidationError[] {
  if (pushResult === undefined) {
    return [];
  }

  return pushResult.results.flatMap((result, index) => {
    if (result.syncStatus === "synced") {
      return [];
    }

    return [
      ValidationErrorSchema.parse({
        errorCode: "sync_failed",
        message:
          result.message ?? "Braze template translation writeback did not complete.",
        severity: result.syncStatus === "skipped" ? "warning" : "error",
        fieldPathSegments: ["pushResult", "results", index],
        sourceEntryId: result.entryId
      })
    ];
  });
}

function hasBlockingValidationErrors(
  validationErrors: readonly ValidationError[]
): boolean {
  return validationErrors.some((validationError) => validationError.severity === "error");
}

function isSuccessfulTranslation(
  translation: TranslationResponseEntry
): boolean {
  return (
    translation.validationErrors.length === 0 &&
    translation.translatedText.trim().length > 0
  );
}

function dedupeValidationErrors(
  validationErrors: readonly ValidationError[]
): ValidationError[] {
  const seen = new Set<string>();

  return validationErrors.filter((validationError) => {
    const errorKey = JSON.stringify([
      validationError.errorCode,
      validationError.message,
      validationError.severity,
      validationError.sourceEntryId ?? null,
      validationError.fieldPathSegments ?? null
    ]);

    if (seen.has(errorKey)) {
      return false;
    }

    seen.add(errorKey);
    return true;
  });
}

function createTemplateTranslationRequestId(
  templateId: string,
  targetLocale: string,
  batchIndex: number,
  timestamp: string
): string {
  return [
    "template.translate",
    toIdentifierFragment(templateId),
    toIdentifierFragment(targetLocale),
    batchIndex.toString(),
    toIdentifierFragment(timestamp)
  ].join(".");
}

function toIdentifierFragment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._:-]/g, "-");
}

function createTranslationKey(entryId: string, targetLocale: string): string {
  return `${entryId}::${targetLocale}`;
}

function getTemplateTranslateStatus(
  completedTranslationCount: number,
  requestedTranslationCount: number,
  errors: readonly ValidationError[]
): TemplateTranslateResponse["resultStatus"] {
  if (requestedTranslationCount === 0) {
    return errors.some((error) => error.severity === "error") ? "failed" : "success";
  }

  if (completedTranslationCount === requestedTranslationCount) {
    return "success";
  }

  if (completedTranslationCount === 0) {
    return "failed";
  }

  return "partial";
}
