import { z } from "zod";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function isNonBlankString(value: string): boolean {
  return value.trim().length > 0;
}

function addDuplicateValueIssues(
  values: readonly string[],
  issuePathPrefix: readonly (string | number)[],
  ctx: z.RefinementCtx,
  errorMessage: string
): void {
  const seen = new Map<string, number>();

  values.forEach((value, index) => {
    const previousIndex = seen.get(value);

    if (previousIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: errorMessage,
        path: [...issuePathPrefix, index]
      });
      return;
    }

    seen.set(value, index);
  });
}

const NonBlankStringSchema = z
  .string()
  .min(1, "Expected a non-empty string.")
  .refine(isNonBlankString, "Expected a non-blank string.");

export const IdentifierSchema = z
  .string()
  .min(1, "Identifier must not be empty.")
  .regex(
    IDENTIFIER_PATTERN,
    "Identifier may contain only letters, numbers, dots, underscores, colons, and hyphens."
  );

export const LocaleCodeSchema = z
  .string()
  .min(2, "Locale code must not be empty.")
  .max(35, "Locale code is unexpectedly long.")
  .regex(LOCALE_PATTERN, "Locale code must follow a BCP 47-like format.");

export const IsoDatetimeSchema = z.string().datetime({
  offset: true,
  message: "Expected an ISO 8601 datetime with timezone information."
});

export const TextRangeSchema = z
  .object({
    startOffset: z.number().int().nonnegative(),
    endOffsetExclusive: z.number().int().nonnegative()
  })
  .superRefine((value, ctx) => {
    if (value.endOffsetExclusive <= value.startOffset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endOffsetExclusive must be greater than startOffset.",
        path: ["endOffsetExclusive"]
      });
    }
  });

export const BrazeMessageChannelSchema = z.enum([
  "email",
  "push",
  "in_app",
  "content_card",
  "sms",
  "webhook"
]);

export const ContentFieldTypeSchema = z.enum([
  "html",
  "plain_text",
  "subject",
  "preheader",
  "title",
  "subtitle"
]);

export const ValidationSeveritySchema = z.enum(["error", "warning"]);

export const ValidationErrorCodeSchema = z.enum([
  "invalid_input",
  "invalid_locale",
  "invalid_liquid_syntax",
  "ambiguous_content",
  "unsupported_content",
  "overlapping_entry_range",
  "duplicate_entry_id",
  "duplicate_target_locale",
  "missing_translation",
  "invalid_translation",
  "sync_failed",
  "transform_failed"
]);

export const ValidationErrorSchema = z.object({
  errorCode: ValidationErrorCodeSchema,
  message: NonBlankStringSchema,
  severity: ValidationSeveritySchema,
  fieldPathSegments: z
    .array(z.union([z.string(), z.number().int().nonnegative()]))
    .optional(),
  sourceEntryId: IdentifierSchema.optional(),
  sourceRange: TextRangeSchema.optional()
});

export const TranslationEntrySchema = z.object({
  entryId: IdentifierSchema,
  extractionId: IdentifierSchema,
  sourceLocale: LocaleCodeSchema,
  messageChannel: BrazeMessageChannelSchema,
  contentFieldKey: NonBlankStringSchema,
  contentFieldType: ContentFieldTypeSchema,
  sourceText: NonBlankStringSchema,
  sourceTextChecksum: NonBlankStringSchema,
  sourceRange: TextRangeSchema,
  surroundingTextBefore: z.string(),
  surroundingTextAfter: z.string(),
  preservedLiquidBlocks: z.array(z.string())
});

export const ExtractedContentPayloadSchema = z
  .object({
    extractionId: IdentifierSchema,
    sourcePlatform: z.literal("braze"),
    sourceWorkspaceId: IdentifierSchema.optional(),
    sourceCampaignId: IdentifierSchema.optional(),
    sourceCanvasId: IdentifierSchema.optional(),
    sourceMessageId: IdentifierSchema,
    sourceMessageVariantId: IdentifierSchema.optional(),
    messageChannel: BrazeMessageChannelSchema,
    contentFieldKey: NonBlankStringSchema,
    contentFieldType: ContentFieldTypeSchema,
    sourceLocale: LocaleCodeSchema,
    rawContent: z.string(),
    contentChecksum: NonBlankStringSchema,
    detectedLiquid: z.boolean(),
    translationEntries: z.array(TranslationEntrySchema),
    validationErrors: z.array(ValidationErrorSchema),
    extractedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    addDuplicateValueIssues(
      value.translationEntries.map((entry) => entry.entryId),
      ["translationEntries"],
      ctx,
      "translationEntries must not contain duplicate entryId values."
    );

    value.translationEntries.forEach((entry, index) => {
      if (entry.extractionId !== value.extractionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "translationEntries extractionId must match the parent extractionId.",
          path: ["translationEntries", index, "extractionId"]
        });
      }
    });
  });

export const TransformStatusSchema = z.enum(["success", "failed"]);

export const TransformResultSchema = z
  .object({
    transformId: IdentifierSchema,
    extractionId: IdentifierSchema,
    transformStatus: TransformStatusSchema,
    originalContent: z.string(),
    transformedContent: z.string().nullable(),
    contentChanged: z.boolean(),
    appliedTranslationTagCount: z.number().int().nonnegative(),
    translationEntries: z.array(TranslationEntrySchema),
    validationErrors: z.array(ValidationErrorSchema),
    generatedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    if (
      value.transformStatus === "success" &&
      value.transformedContent === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Successful transforms must include transformedContent.",
        path: ["transformedContent"]
      });
    }

    if (!value.contentChanged && value.appliedTranslationTagCount > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "appliedTranslationTagCount must be 0 when contentChanged is false.",
        path: ["appliedTranslationTagCount"]
      });
    }
  });

export const TranslationRequestSchema = z
  .object({
    requestId: IdentifierSchema,
    extractionId: IdentifierSchema,
    sourceLocale: LocaleCodeSchema,
    targetLocales: z.array(LocaleCodeSchema).min(1),
    entries: z.array(TranslationEntrySchema).min(1),
    requestedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    addDuplicateValueIssues(
      value.targetLocales,
      ["targetLocales"],
      ctx,
      "targetLocales must not contain duplicate locale codes."
    );

    addDuplicateValueIssues(
      value.entries.map((entry) => entry.entryId),
      ["entries"],
      ctx,
      "entries must not contain duplicate entryId values."
    );

    value.entries.forEach((entry, index) => {
      if (entry.extractionId !== value.extractionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "entries extractionId must match the request extractionId.",
          path: ["entries", index, "extractionId"]
        });
      }

      if (entry.sourceLocale !== value.sourceLocale) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "entries sourceLocale must match the request sourceLocale.",
          path: ["entries", index, "sourceLocale"]
        });
      }
    });
  });

export const TranslationResponseStatusSchema = z.enum([
  "success",
  "partial",
  "failed"
]);

export const TranslationResponseEntrySchema = z.object({
  entryId: IdentifierSchema,
  targetLocale: LocaleCodeSchema,
  translatedText: z.string(),
  translatedTextChecksum: NonBlankStringSchema,
  validationErrors: z.array(ValidationErrorSchema)
});

export const TranslationResponseSchema = z
  .object({
    requestId: IdentifierSchema,
    responseStatus: TranslationResponseStatusSchema,
    translations: z.array(TranslationResponseEntrySchema),
    validationErrors: z.array(ValidationErrorSchema),
    completedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    addDuplicateValueIssues(
      value.translations.map(
        (translation) => `${translation.entryId}::${translation.targetLocale}`
      ),
      ["translations"],
      ctx,
      "translations must not contain duplicate entryId and targetLocale pairs."
    );
  });

export const BrazeTemplateEntrySchema = z.object({
  entryId: IdentifierSchema,
  messageChannel: BrazeMessageChannelSchema,
  contentFieldKey: NonBlankStringSchema,
  contentFieldType: ContentFieldTypeSchema,
  sourceText: NonBlankStringSchema,
  sourceTextChecksum: NonBlankStringSchema,
  sourceRange: TextRangeSchema,
  surroundingTextBefore: z.string(),
  surroundingTextAfter: z.string(),
  preservedLiquidBlocks: z.array(z.string())
});

export const BrazeTemplateSourceDataSchema = z
  .object({
    templateId: IdentifierSchema,
    extractionId: IdentifierSchema,
    sourceLocale: LocaleCodeSchema,
    entries: z.array(BrazeTemplateEntrySchema),
    existingTranslations: z.array(TranslationResponseEntrySchema),
    validationErrors: z.array(ValidationErrorSchema),
    fetchedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    if (
      value.entries.length === 0 &&
      !value.validationErrors.some((validationError) => validationError.severity === "error")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "entries must contain at least one template segment when there are no blocking validation errors.",
        path: ["entries"]
      });
    }

    addDuplicateValueIssues(
      value.entries.map((entry) => entry.entryId),
      ["entries"],
      ctx,
      "entries must not contain duplicate entryId values."
    );

    addDuplicateValueIssues(
      value.existingTranslations.map(
        (translation) => `${translation.entryId}::${translation.targetLocale}`
      ),
      ["existingTranslations"],
      ctx,
      "existingTranslations must not contain duplicate entryId and targetLocale pairs."
    );
  });

export const TranslationSummarySchema = z
  .object({
    entryCount: z.number().int().nonnegative(),
    targetLocaleCount: z.number().int().nonnegative(),
    requestedTranslationCount: z.number().int().nonnegative(),
    completedTranslationCount: z.number().int().nonnegative(),
    skippedTranslationCount: z.number().int().nonnegative(),
    failedTranslationCount: z.number().int().nonnegative()
  })
  .superRefine((value, ctx) => {
    const accountedTranslationCount =
      value.completedTranslationCount +
      value.skippedTranslationCount +
      value.failedTranslationCount;

    if (accountedTranslationCount !== value.requestedTranslationCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "completedTranslationCount, skippedTranslationCount, and failedTranslationCount must add up to requestedTranslationCount.",
        path: ["requestedTranslationCount"]
      });
    }

    if (
      value.requestedTranslationCount >
      value.entryCount * value.targetLocaleCount
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "requestedTranslationCount must not exceed entryCount multiplied by targetLocaleCount.",
        path: ["requestedTranslationCount"]
      });
    }
  });

export const TemplateTranslationRequestSchema = z
  .object({
    requestId: IdentifierSchema,
    sourceWorkspaceId: IdentifierSchema.optional(),
    templateId: IdentifierSchema,
    sourceLocale: LocaleCodeSchema.optional(),
    targetLocales: z.array(LocaleCodeSchema).min(1),
    requestedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    addDuplicateValueIssues(
      value.targetLocales,
      ["targetLocales"],
      ctx,
      "targetLocales must not contain duplicate locale codes."
    );
  });

export const TemplateTranslationResultStatusSchema = z.enum([
  "success",
  "partial",
  "failed"
]);

export const TemplateTranslationResultSchema = z
  .object({
    requestId: IdentifierSchema,
    sourceWorkspaceId: IdentifierSchema.optional(),
    templateId: IdentifierSchema,
    sourceLocale: LocaleCodeSchema.optional(),
    targetLocales: z.array(LocaleCodeSchema).min(1),
    resultStatus: TemplateTranslationResultStatusSchema,
    translationEntries: z.array(TranslationEntrySchema),
    translations: z.array(TranslationResponseEntrySchema),
    summary: TranslationSummarySchema,
    validationErrors: z.array(ValidationErrorSchema),
    completedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    addDuplicateValueIssues(
      value.targetLocales,
      ["targetLocales"],
      ctx,
      "targetLocales must not contain duplicate locale codes."
    );

    addDuplicateValueIssues(
      value.translationEntries.map((entry) => entry.entryId),
      ["translationEntries"],
      ctx,
      "translationEntries must not contain duplicate entryId values."
    );

    addDuplicateValueIssues(
      value.translations.map(
        (translation) => `${translation.entryId}::${translation.targetLocale}`
      ),
      ["translations"],
      ctx,
      "translations must not contain duplicate entryId and targetLocale pairs."
    );

    if (value.summary.entryCount !== value.translationEntries.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "summary.entryCount must match translationEntries.length.",
        path: ["summary", "entryCount"]
      });
    }

    if (value.summary.targetLocaleCount !== value.targetLocales.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "summary.targetLocaleCount must match targetLocales.length.",
        path: ["summary", "targetLocaleCount"]
      });
    }

    if (value.translations.length > value.summary.requestedTranslationCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "translations.length must not exceed summary.requestedTranslationCount.",
        path: ["translations"]
      });
    }

    value.translationEntries.forEach((entry, index) => {
      if (
        value.sourceLocale !== undefined &&
        entry.sourceLocale !== value.sourceLocale
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "translationEntries sourceLocale must match the result sourceLocale when sourceLocale is provided.",
          path: ["translationEntries", index, "sourceLocale"]
        });
      }
    });

    value.translations.forEach((translation, index) => {
      if (!value.targetLocales.includes(translation.targetLocale)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "translations targetLocale must be included in targetLocales.",
          path: ["translations", index, "targetLocale"]
        });
      }
    });

    if (
      value.resultStatus === "success" &&
      value.summary.failedTranslationCount !== 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Successful template translation results must not report failed translations.",
        path: ["summary", "failedTranslationCount"]
      });
    }

    if (
      value.resultStatus === "failed" &&
      value.summary.completedTranslationCount !== 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Failed template translation results must not report completed translations.",
        path: ["summary", "completedTranslationCount"]
      });
    }
  });

export const TemplateTranslateRequestSchema = z
  .object({
    templateId: IdentifierSchema,
    targetLocales: z.array(LocaleCodeSchema).min(1)
  })
  .superRefine((value, ctx) => {
    addDuplicateValueIssues(
      value.targetLocales,
      ["targetLocales"],
      ctx,
      "targetLocales must not contain duplicate locale codes."
    );
  });

export const TemplateTranslateStatusSchema = z.enum([
  "success",
  "partial",
  "failed"
]);

export const TemplateTranslateSkippedSchema = z.object({
  existingTranslations: z.number().int().nonnegative(),
  failedTranslations: z.number().int().nonnegative(),
  pushFailures: z.number().int().nonnegative()
});

export const TemplateTranslateResponseSchema = z.object({
  templateId: IdentifierSchema,
  resultStatus: TemplateTranslateStatusSchema,
  localesProcessed: z.array(LocaleCodeSchema),
  newTranslations: z.number().int().nonnegative(),
  skipped: TemplateTranslateSkippedSchema,
  errors: z.array(ValidationErrorSchema),
  completedAt: IsoDatetimeSchema
});

export const TranslationCsvRowStatusSchema = z.enum([
  "pending",
  "translated",
  "needs_review"
]);

export const TranslationCsvRowSchema = z.object({
  translation_id: IdentifierSchema,
  source_locale: LocaleCodeSchema,
  source_text: NonBlankStringSchema,
  target_locale: LocaleCodeSchema,
  translated_text: z.string(),
  status: TranslationCsvRowStatusSchema
});

export const CsvExportRequestSchema = TranslationRequestSchema;

export const CsvExportStatusSchema = z.enum(["success", "failed"]);

export const CsvExportResponseSchema = z
  .object({
    requestId: IdentifierSchema,
    exportStatus: CsvExportStatusSchema,
    csvContent: z.string().nullable(),
    csvRowCount: z.number().int().nonnegative(),
    validationErrors: z.array(ValidationErrorSchema),
    completedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    if (value.exportStatus === "success" && value.csvContent === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Successful CSV exports must include csvContent.",
        path: ["csvContent"]
      });
    }

    if (value.csvContent === null && value.csvRowCount !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "csvRowCount must be 0 when csvContent is null.",
        path: ["csvRowCount"]
      });
    }
  });

export const CsvImportRequestSchema = z.object({
  importId: IdentifierSchema,
  requestId: IdentifierSchema.optional(),
  csvContent: NonBlankStringSchema,
  requestedAt: IsoDatetimeSchema
});

export const CsvImportStatusSchema = z.enum([
  "success",
  "partial",
  "failed"
]);

export const CsvImportResponseSchema = z
  .object({
    importId: IdentifierSchema,
    requestId: IdentifierSchema.optional(),
    importStatus: CsvImportStatusSchema,
    parsedRowCount: z.number().int().nonnegative(),
    acceptedTranslationCount: z.number().int().nonnegative(),
    translations: z.array(TranslationResponseEntrySchema),
    validationErrors: z.array(ValidationErrorSchema),
    completedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    if (value.acceptedTranslationCount > value.parsedRowCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "acceptedTranslationCount must not exceed parsedRowCount.",
        path: ["acceptedTranslationCount"]
      });
    }

    addDuplicateValueIssues(
      value.translations.map(
        (translation) => `${translation.entryId}::${translation.targetLocale}`
      ),
      ["translations"],
      ctx,
      "translations must not contain duplicate entryId and targetLocale pairs."
    );

    if (
      value.importStatus === "success" &&
      value.acceptedTranslationCount !== value.parsedRowCount
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Successful CSV imports must accept every parsed row as a translation.",
        path: ["acceptedTranslationCount"]
      });
    }

    if (value.importStatus === "failed" && value.acceptedTranslationCount !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed CSV imports must not report accepted translations.",
        path: ["acceptedTranslationCount"]
      });
    }
  });

export const BrazeSyncRequestSchema = z
  .object({
    syncId: IdentifierSchema,
    requestId: IdentifierSchema.optional(),
    translations: z.array(TranslationResponseEntrySchema).min(1),
    requestedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    addDuplicateValueIssues(
      value.translations.map(
        (translation) => `${translation.entryId}::${translation.targetLocale}`
      ),
      ["translations"],
      ctx,
      "translations must not contain duplicate entryId and targetLocale pairs."
    );
  });

export const BrazeSyncItemStatusSchema = z.enum([
  "synced",
  "skipped",
  "failed"
]);

export const BrazeSyncItemSchema = z.object({
  entryId: IdentifierSchema,
  targetLocale: LocaleCodeSchema,
  brazeContentBlockKey: IdentifierSchema,
  syncStatus: BrazeSyncItemStatusSchema,
  message: NonBlankStringSchema.optional()
});

export const BrazeSyncResultStatusSchema = z.enum([
  "success",
  "partial",
  "failed"
]);

export const BrazeSyncResultSchema = z
  .object({
    syncId: IdentifierSchema,
    requestId: IdentifierSchema.optional(),
    syncStatus: BrazeSyncResultStatusSchema,
    syncedEntryCount: z.number().int().nonnegative(),
    syncedTranslations: z.array(BrazeSyncItemSchema),
    validationErrors: z.array(ValidationErrorSchema),
    completedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    if (value.syncedEntryCount > value.syncedTranslations.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "syncedEntryCount must not exceed syncedTranslations.length.",
        path: ["syncedEntryCount"]
      });
    }

    if (
      value.syncStatus === "success" &&
      value.syncedEntryCount !== value.syncedTranslations.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Successful sync results must count every translated entry as synced.",
        path: ["syncedEntryCount"]
      });
    }

    if (value.syncStatus === "failed" && value.syncedEntryCount !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed sync results must not report synced entries.",
        path: ["syncedEntryCount"]
      });
    }
  });

export const BrazeTemplatePushRequestSchema = z
  .object({
    templateId: IdentifierSchema,
    newTranslations: z.array(TranslationResponseEntrySchema).min(1),
    mergedTranslations: z.array(TranslationResponseEntrySchema).min(1),
    requestedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    addDuplicateValueIssues(
      value.newTranslations.map(
        (translation) => `${translation.entryId}::${translation.targetLocale}`
      ),
      ["newTranslations"],
      ctx,
      "newTranslations must not contain duplicate entryId and targetLocale pairs."
    );

    addDuplicateValueIssues(
      value.mergedTranslations.map(
        (translation) => `${translation.entryId}::${translation.targetLocale}`
      ),
      ["mergedTranslations"],
      ctx,
      "mergedTranslations must not contain duplicate entryId and targetLocale pairs."
    );
  });

export const BrazeTemplatePushItemSchema = z.object({
  entryId: IdentifierSchema,
  targetLocale: LocaleCodeSchema,
  syncStatus: BrazeSyncItemStatusSchema,
  message: NonBlankStringSchema.optional()
});

export const BrazeTemplatePushResultSchema = z
  .object({
    templateId: IdentifierSchema,
    pushStatus: BrazeSyncResultStatusSchema,
    pushedTranslationCount: z.number().int().nonnegative(),
    results: z.array(BrazeTemplatePushItemSchema),
    validationErrors: z.array(ValidationErrorSchema),
    completedAt: IsoDatetimeSchema
  })
  .superRefine((value, ctx) => {
    if (value.pushedTranslationCount > value.results.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pushedTranslationCount must not exceed results.length.",
        path: ["pushedTranslationCount"]
      });
    }

    if (
      value.pushStatus === "success" &&
      value.pushedTranslationCount !== value.results.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Successful push results must count every pushed translation as synced.",
        path: ["pushedTranslationCount"]
      });
    }

    if (value.pushStatus === "failed" && value.pushedTranslationCount !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed push results must not report pushed translations.",
        path: ["pushedTranslationCount"]
      });
    }
  });

export const CanvasTranslateRequestSchema = z.object({
  canvasId: NonBlankStringSchema
});

export const CanvasStepResultStatusSchema = z.enum([
  "success",
  "partial",
  "skipped",
  "failed"
]);

export const CanvasStepResultSchema = z.object({
  stepId: NonBlankStringSchema,
  stepName: z.string(),
  messageVariationId: NonBlankStringSchema,
  channel: z.string(),
  status: CanvasStepResultStatusSchema,
  localesTranslated: z.array(z.string()),
  translationsPushed: z.number().int().nonnegative(),
  errors: z.array(z.string())
});

export const CanvasTranslateStatusSchema = z.enum([
  "success",
  "partial",
  "failed"
]);

export const CanvasTranslateResponseSchema = z.object({
  canvasId: NonBlankStringSchema,
  canvasName: z.string(),
  resultStatus: CanvasTranslateStatusSchema,
  stepsProcessed: z.number().int().nonnegative(),
  totalTranslationsPushed: z.number().int().nonnegative(),
  stepResults: z.array(CanvasStepResultSchema),
  errors: z.array(z.string()),
  completedAt: IsoDatetimeSchema
});

export const ApiErrorCodeSchema = z.enum([
  "invalid_request",
  "internal_error"
]);

export const ApiErrorResponseSchema = z.object({
  errorCode: ApiErrorCodeSchema,
  message: NonBlankStringSchema,
  validationErrors: z.array(ValidationErrorSchema)
});

export type TextRange = z.infer<typeof TextRangeSchema>;
export type BrazeMessageChannel = z.infer<typeof BrazeMessageChannelSchema>;
export type ContentFieldType = z.infer<typeof ContentFieldTypeSchema>;
export type ValidationSeverity = z.infer<typeof ValidationSeveritySchema>;
export type ValidationErrorCode = z.infer<typeof ValidationErrorCodeSchema>;
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
export type TranslationEntry = z.infer<typeof TranslationEntrySchema>;
export type ExtractedContentPayload = z.infer<
  typeof ExtractedContentPayloadSchema
>;
export type TransformStatus = z.infer<typeof TransformStatusSchema>;
export type TransformResult = z.infer<typeof TransformResultSchema>;
export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;
export type TranslationResponseStatus = z.infer<
  typeof TranslationResponseStatusSchema
>;
export type TranslationResponseEntry = z.infer<
  typeof TranslationResponseEntrySchema
>;
export type TranslationResponse = z.infer<typeof TranslationResponseSchema>;
export type BrazeTemplateEntry = z.infer<typeof BrazeTemplateEntrySchema>;
export type BrazeTemplateSourceData = z.infer<
  typeof BrazeTemplateSourceDataSchema
>;
export type TranslationSummary = z.infer<typeof TranslationSummarySchema>;
export type TemplateTranslationRequest = z.infer<
  typeof TemplateTranslationRequestSchema
>;
export type TemplateTranslationResultStatus = z.infer<
  typeof TemplateTranslationResultStatusSchema
>;
export type TemplateTranslationResult = z.infer<
  typeof TemplateTranslationResultSchema
>;
export type TemplateTranslateRequest = z.infer<
  typeof TemplateTranslateRequestSchema
>;
export type TemplateTranslateStatus = z.infer<
  typeof TemplateTranslateStatusSchema
>;
export type TemplateTranslateSkipped = z.infer<
  typeof TemplateTranslateSkippedSchema
>;
export type TemplateTranslateResponse = z.infer<
  typeof TemplateTranslateResponseSchema
>;
export type TranslationCsvRowStatus = z.infer<
  typeof TranslationCsvRowStatusSchema
>;
export type TranslationCsvRow = z.infer<typeof TranslationCsvRowSchema>;
export type CsvExportRequest = z.infer<typeof CsvExportRequestSchema>;
export type CsvExportStatus = z.infer<typeof CsvExportStatusSchema>;
export type CsvExportResponse = z.infer<typeof CsvExportResponseSchema>;
export type CsvImportRequest = z.infer<typeof CsvImportRequestSchema>;
export type CsvImportStatus = z.infer<typeof CsvImportStatusSchema>;
export type CsvImportResponse = z.infer<typeof CsvImportResponseSchema>;
export type BrazeSyncRequest = z.infer<typeof BrazeSyncRequestSchema>;
export type BrazeSyncItemStatus = z.infer<typeof BrazeSyncItemStatusSchema>;
export type BrazeSyncItem = z.infer<typeof BrazeSyncItemSchema>;
export type BrazeSyncResultStatus = z.infer<
  typeof BrazeSyncResultStatusSchema
>;
export type BrazeSyncResult = z.infer<typeof BrazeSyncResultSchema>;
export type BrazeTemplatePushRequest = z.infer<
  typeof BrazeTemplatePushRequestSchema
>;
export type BrazeTemplatePushItem = z.infer<
  typeof BrazeTemplatePushItemSchema
>;
export type BrazeTemplatePushResult = z.infer<
  typeof BrazeTemplatePushResultSchema
>;
export type CanvasTranslateRequest = z.infer<
  typeof CanvasTranslateRequestSchema
>;
export type CanvasStepResultStatus = z.infer<
  typeof CanvasStepResultStatusSchema
>;
export type CanvasStepResult = z.infer<typeof CanvasStepResultSchema>;
export type CanvasTranslateStatus = z.infer<
  typeof CanvasTranslateStatusSchema
>;
export type CanvasTranslateResponse = z.infer<
  typeof CanvasTranslateResponseSchema
>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
