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
