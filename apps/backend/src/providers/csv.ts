import { createHash } from "node:crypto";

import {
  createTranslationCsvRows,
  parseTranslationCsv,
  stringifyTranslationCsv
} from "@braze-ai-translator/csv-utils";
import {
  CsvExportResponseSchema,
  CsvImportResponseSchema,
  TranslationCsvRowSchema,
  ValidationErrorSchema,
  type CsvExportRequest,
  type CsvExportResponse,
  type CsvImportRequest,
  type CsvImportResponse,
  type ValidationError
} from "@braze-ai-translator/schemas";

export interface CsvProvider {
  export(request: CsvExportRequest): Promise<CsvExportResponse>;
  import(request: CsvImportRequest): Promise<CsvImportResponse>;
}

export interface CsvProviderContext {
  readonly now: () => string;
}

export class LocalCsvProvider implements CsvProvider {
  constructor(private readonly context: CsvProviderContext) {}

  async export(request: CsvExportRequest): Promise<CsvExportResponse> {
    const rows = createTranslationCsvRows(
      request.entries.map((entry) => ({
        key: entry.entryId,
        source: entry.sourceText
      })),
      {
        sourceLocale: request.sourceLocale,
        targetLocales: request.targetLocales
      }
    );
    const csvContent = stringifyTranslationCsv(rows);

    return CsvExportResponseSchema.parse({
      requestId: request.requestId,
      exportStatus: "success",
      csvContent,
      csvRowCount: rows.length,
      validationErrors: [],
      completedAt: this.context.now()
    });
  }

  async import(request: CsvImportRequest): Promise<CsvImportResponse> {
    try {
      const rows = parseTranslationCsv(request.csvContent);

      if (rows.length === 0) {
        return this.createFailedImportResponse(
          request,
          "CSV import did not contain any translation rows.",
          ["csvContent"]
        );
      }

      const translations: CsvImportResponse["translations"] = [];
      const validationErrors: ValidationError[] = [];

      rows.forEach((row, rowIndex) => {
        const parsedRow = TranslationCsvRowSchema.safeParse(row);

        if (!parsedRow.success) {
          validationErrors.push(
            ...parsedRow.error.issues.map((issue) =>
              createValidationError({
                errorCode: "invalid_input",
                message: issue.message,
                fieldPathSegments: ["rows", rowIndex, ...issue.path]
              })
            )
          );
          return;
        }

        if (parsedRow.data.translated_text.trim().length === 0) {
          validationErrors.push(
            createValidationError({
              errorCode: "missing_translation",
              message:
                "CSV row does not contain translated_text and cannot be imported.",
              fieldPathSegments: ["rows", rowIndex, "translated_text"],
              sourceEntryId: parsedRow.data.translation_id
            })
          );
          return;
        }

        // TODO: validate imported source text and locale metadata against the
        // originating export request once the server persists export jobs.
        translations.push({
          entryId: parsedRow.data.translation_id,
          targetLocale: parsedRow.data.target_locale,
          translatedText: parsedRow.data.translated_text,
          translatedTextChecksum: createChecksum(parsedRow.data.translated_text),
          validationErrors: []
        });
      });

      return CsvImportResponseSchema.parse({
        importId: request.importId,
        requestId: request.requestId,
        importStatus: getCsvImportStatus(translations.length, rows.length),
        parsedRowCount: rows.length,
        acceptedTranslationCount: translations.length,
        translations,
        validationErrors,
        completedAt: this.context.now()
      });
    } catch (error) {
      return this.createFailedImportResponse(
        request,
        error instanceof Error
          ? error.message
          : "CSV import failed unexpectedly.",
        ["csvContent"]
      );
    }
  }

  private createFailedImportResponse(
    request: CsvImportRequest,
    message: string,
    fieldPathSegments: readonly (string | number)[]
  ): CsvImportResponse {
    return CsvImportResponseSchema.parse({
      importId: request.importId,
      requestId: request.requestId,
      importStatus: "failed",
      parsedRowCount: 0,
      acceptedTranslationCount: 0,
      translations: [],
      validationErrors: [
        createValidationError({
          errorCode: "invalid_input",
          message,
          fieldPathSegments: [...fieldPathSegments]
        })
      ],
      completedAt: this.context.now()
    });
  }
}

function getCsvImportStatus(
  acceptedTranslationCount: number,
  parsedRowCount: number
): CsvImportResponse["importStatus"] {
  if (acceptedTranslationCount === parsedRowCount) {
    return "success";
  }

  if (acceptedTranslationCount === 0) {
    return "failed";
  }

  return "partial";
}

function createChecksum(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function createValidationError(
  error: Omit<ValidationError, "severity"> & {
    readonly severity?: ValidationError["severity"];
  }
): ValidationError {
  return ValidationErrorSchema.parse({
    severity: error.severity ?? "error",
    ...error
  });
}
