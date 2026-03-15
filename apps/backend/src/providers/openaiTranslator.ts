import { createHash } from "node:crypto";

import { z } from "zod";

import {
  TranslationResponseSchema,
  ValidationErrorSchema,
  type TranslationRequest,
  type TranslationResponse,
  type ValidationError
} from "@braze-ai-translator/schemas";

import type { TranslationProvider } from "../providers.js";

const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const PROTECTED_TOKEN_PREFIX = "__BRAZE_TOKEN_";

const TranslationModelOutputSchema = z.object({
  translatedText: z.string().min(1)
});

const OpenAIMessageContentSchema = z.object({
  type: z.string(),
  text: z.string().optional()
});

const OpenAIOutputItemSchema = z.object({
  type: z.string(),
  content: z.array(OpenAIMessageContentSchema).optional()
});

const OpenAIResponsesCreateResponseSchema = z.object({
  status: z.string(),
  error: z
    .object({
      message: z.string()
    })
    .nullable()
    .optional(),
  output: z.array(OpenAIOutputItemSchema).optional()
});

const OpenAIErrorResponseSchema = z.object({
  error: z.object({
    message: z.string()
  })
});

const TranslationResponseJsonSchema = {
  type: "object",
  properties: {
    translatedText: {
      type: "string",
      minLength: 1
    }
  },
  required: ["translatedText"],
  additionalProperties: false
} as const;

interface DelimiterPair {
  readonly open: string;
  readonly close: string;
}

const PROTECTED_DELIMITERS: readonly DelimiterPair[] = [
  { open: "{{{", close: "}}}" },
  { open: "{{", close: "}}" },
  { open: "{%", close: "%}" }
];

const STRAY_CLOSING_DELIMITERS = ["}}}", "}}", "%}"] as const;

export interface OpenAITranslatorPlaceholder {
  readonly token: string;
  readonly original: string;
}

export interface ProtectedTemplateText {
  readonly protectedText: string;
  readonly placeholders: readonly OpenAITranslatorPlaceholder[];
  readonly validationErrors: readonly ValidationError[];
}

export interface RestoredTemplateText {
  readonly restoredText: string;
  readonly validationErrors: readonly ValidationError[];
}

export interface PlaceholderProtectionOptions {
  readonly sourceEntryId?: string;
}

export interface OpenAITranslationClientRequest {
  readonly model: string;
  readonly sourceLocale: string;
  readonly targetLocale: string;
  readonly protectedText: string;
}

export interface OpenAITranslationClient {
  translateText(request: OpenAITranslationClientRequest): Promise<string>;
}

export interface OpenAITranslationProviderOptions {
  readonly now: () => string;
  readonly client?: OpenAITranslationClient;
  readonly apiKey?: string;
  readonly model?: string;
  readonly fetchFn?: typeof fetch;
}

interface OpenAIResponsesApiClientOptions {
  readonly apiKey: string;
  readonly fetchFn: typeof fetch;
}

export class OpenAITranslationProvider implements TranslationProvider {
  private readonly client: OpenAITranslationClient;

  constructor(private readonly options: OpenAITranslationProviderOptions) {
    this.client =
      options.client ??
      new OpenAIResponsesApiClient({
        apiKey: options.apiKey ?? "",
        fetchFn: options.fetchFn ?? fetch
      });
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const model = this.options.model ?? "";

    if (model.length === 0) {
      throw new Error(
        "OPENAI_MODEL is required to translate entries with the OpenAI provider."
      );
    }

    if (
      this.options.client === undefined &&
      (this.options.apiKey ?? "").length === 0
    ) {
      throw new Error(
        "OPENAI_API_KEY is required to translate entries with the OpenAI provider."
      );
    }

    const translations = await Promise.all(
      request.targetLocales.flatMap((targetLocale) =>
        request.entries.map((entry) =>
          this.translateEntry(entry, targetLocale, request.sourceLocale, model)
        )
      )
    );
    const validationErrors = translations.flatMap(
      (translation) => translation.validationErrors
    );
    const successfulTranslationCount = translations.filter(
      (translation) => translation.validationErrors.length === 0
    ).length;

    return TranslationResponseSchema.parse({
      requestId: request.requestId,
      responseStatus: getTranslationResponseStatus(
        successfulTranslationCount,
        translations.length
      ),
      translations,
      validationErrors,
      completedAt: this.options.now()
    });
  }

  private async translateEntry(
    entry: TranslationRequest["entries"][number],
    targetLocale: string,
    sourceLocale: string,
    model: string
  ): Promise<TranslationResponse["translations"][number]> {
    const protectedSource = protectTemplatePlaceholders(entry.sourceText, {
      sourceEntryId: entry.entryId
    });

    if (protectedSource.validationErrors.length > 0) {
      return createFailedTranslationEntry(
        entry.entryId,
        targetLocale,
        entry.sourceText,
        protectedSource.validationErrors
      );
    }

    const translatedProtectedText = await this.client.translateText({
      model,
      sourceLocale,
      targetLocale,
      protectedText: protectedSource.protectedText
    });
    const restoredTranslation = restoreTemplatePlaceholders(
      translatedProtectedText,
      protectedSource.placeholders,
      {
        sourceEntryId: entry.entryId
      }
    );

    if (restoredTranslation.validationErrors.length > 0) {
      return createFailedTranslationEntry(
        entry.entryId,
        targetLocale,
        entry.sourceText,
        restoredTranslation.validationErrors
      );
    }

    return {
      entryId: entry.entryId,
      targetLocale,
      translatedText: restoredTranslation.restoredText,
      translatedTextChecksum: createChecksum(restoredTranslation.restoredText),
      validationErrors: []
    };
  }
}

class OpenAIResponsesApiClient implements OpenAITranslationClient {
  constructor(private readonly options: OpenAIResponsesApiClientOptions) {}

  async translateText(request: OpenAITranslationClientRequest): Promise<string> {
    const response = await this.options.fetchFn(OPENAI_RESPONSES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify({
        model: request.model,
        store: false,
        instructions: buildTranslationInstructions(
          request.sourceLocale,
          request.targetLocale
        ),
        input: request.protectedText,
        text: {
          format: {
            type: "json_schema",
            name: "translation_result",
            strict: true,
            schema: TranslationResponseJsonSchema
          }
        }
      })
    });
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      const errorResponse = OpenAIErrorResponseSchema.safeParse(payload);

      if (errorResponse.success) {
        throw new Error(errorResponse.data.error.message);
      }

      throw new Error(
        `OpenAI translation request failed with status ${response.status}.`
      );
    }

    const parsedResponse = OpenAIResponsesCreateResponseSchema.parse(payload);

    if (parsedResponse.error?.message) {
      throw new Error(parsedResponse.error.message);
    }

    if (parsedResponse.status !== "completed") {
      throw new Error(
        `OpenAI response did not complete successfully. Received status "${parsedResponse.status}".`
      );
    }

    const outputText = extractResponseOutputText(parsedResponse.output ?? []);
    const parsedOutput = TranslationModelOutputSchema.parse(
      JSON.parse(outputText)
    );

    return parsedOutput.translatedText;
  }
}

export function protectTemplatePlaceholders(
  sourceText: string,
  options: PlaceholderProtectionOptions = {}
): ProtectedTemplateText {
  const placeholders: OpenAITranslatorPlaceholder[] = [];
  const protectedParts: string[] = [];
  let cursor = 0;

  while (cursor < sourceText.length) {
    const openingDelimiter = matchOpeningDelimiter(sourceText, cursor);

    if (openingDelimiter !== undefined) {
      const closingIndex = sourceText.indexOf(
        openingDelimiter.close,
        cursor + openingDelimiter.open.length
      );

      if (closingIndex === -1) {
        return {
          protectedText: sourceText,
          placeholders,
          validationErrors: [
            createInvalidLiquidSyntaxError(
              "Encountered a placeholder opening delimiter without a matching closing delimiter.",
              options
            )
          ]
        };
      }

      const original = sourceText.slice(
        cursor,
        closingIndex + openingDelimiter.close.length
      );
      const token = createPlaceholderToken(placeholders.length);

      placeholders.push({
        token,
        original
      });
      protectedParts.push(token);
      cursor = closingIndex + openingDelimiter.close.length;
      continue;
    }

    const strayClosingDelimiter = matchStrayClosingDelimiter(sourceText, cursor);

    if (strayClosingDelimiter !== undefined) {
      return {
        protectedText: sourceText,
        placeholders,
        validationErrors: [
          createInvalidLiquidSyntaxError(
            `Encountered a stray "${strayClosingDelimiter}" closing delimiter.`,
            options
          )
        ]
      };
    }

    protectedParts.push(sourceText[cursor] ?? "");
    cursor += 1;
  }

  return {
    protectedText: protectedParts.join(""),
    placeholders,
    validationErrors: []
  };
}

export function restoreTemplatePlaceholders(
  translatedText: string,
  placeholders: readonly OpenAITranslatorPlaceholder[],
  options: PlaceholderProtectionOptions = {}
): RestoredTemplateText {
  const validationErrors: ValidationError[] = [];

  placeholders.forEach((placeholder) => {
    const tokenCount = countTokenOccurrences(translatedText, placeholder.token);

    if (tokenCount !== 1) {
      validationErrors.push(
        createInvalidTranslationError(
          `Protected placeholder token "${placeholder.token}" must appear exactly once in the translated output.`,
          options
        )
      );
    }
  });

  const unresolvedTokens = findProtectedTokens(translatedText).filter(
    (token) => !placeholders.some((placeholder) => placeholder.token === token)
  );

  if (unresolvedTokens.length > 0) {
    validationErrors.push(
      createInvalidTranslationError(
        "Translated output contains unknown protected placeholder tokens.",
        options
      )
    );
  }

  if (validationErrors.length > 0) {
    return {
      restoredText: translatedText,
      validationErrors
    };
  }

  const restoredText = placeholders.reduce(
    (currentText, placeholder) =>
      currentText.split(placeholder.token).join(placeholder.original),
    translatedText
  );

  return {
    restoredText,
    validationErrors: []
  };
}

function buildTranslationInstructions(
  sourceLocale: string,
  targetLocale: string
): string {
  return [
    "You translate Braze marketing copy.",
    `Translate from ${sourceLocale} to ${targetLocale}.`,
    "Translate only the human-readable text.",
    "Preserve every protected placeholder token exactly once.",
    "Do not change token spelling, casing, punctuation, or numbering.",
    "Do not add explanations or notes."
  ].join(" ");
}

function extractResponseOutputText(
  outputItems: readonly z.infer<typeof OpenAIOutputItemSchema>[]
): string {
  for (const outputItem of outputItems) {
    const outputText = outputItem.content?.find(
      (contentPart) => contentPart.type === "output_text"
    )?.text;

    if (outputText !== undefined) {
      return outputText;
    }
  }

  throw new Error("OpenAI response did not contain any translated text.");
}

function createPlaceholderToken(index: number): string {
  return `${PROTECTED_TOKEN_PREFIX}${index.toString().padStart(4, "0")}__`;
}

function matchOpeningDelimiter(
  sourceText: string,
  startIndex: number
): DelimiterPair | undefined {
  return PROTECTED_DELIMITERS.find((delimiter) =>
    sourceText.startsWith(delimiter.open, startIndex)
  );
}

function matchStrayClosingDelimiter(
  sourceText: string,
  startIndex: number
): string | undefined {
  return STRAY_CLOSING_DELIMITERS.find((delimiter) =>
    sourceText.startsWith(delimiter, startIndex)
  );
}

function countTokenOccurrences(text: string, token: string): number {
  if (token.length === 0) {
    return 0;
  }

  let occurrenceCount = 0;
  let searchIndex = 0;

  while (true) {
    const foundIndex = text.indexOf(token, searchIndex);

    if (foundIndex === -1) {
      return occurrenceCount;
    }

    occurrenceCount += 1;
    searchIndex = foundIndex + token.length;
  }
}

function findProtectedTokens(text: string): string[] {
  const tokens: string[] = [];
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const tokenStart = text.indexOf(PROTECTED_TOKEN_PREFIX, searchIndex);

    if (tokenStart === -1) {
      return tokens;
    }

    const tokenEnd = text.indexOf("__", tokenStart + PROTECTED_TOKEN_PREFIX.length);

    if (tokenEnd === -1) {
      tokens.push(text.slice(tokenStart));
      return tokens;
    }

    tokens.push(text.slice(tokenStart, tokenEnd + 2));
    searchIndex = tokenEnd + 2;
  }

  return tokens;
}

function getTranslationResponseStatus(
  successfulTranslationCount: number,
  totalTranslationCount: number
): TranslationResponse["responseStatus"] {
  if (successfulTranslationCount === totalTranslationCount) {
    return "success";
  }

  if (successfulTranslationCount === 0) {
    return "failed";
  }

  return "partial";
}

function createFailedTranslationEntry(
  entryId: string,
  targetLocale: string,
  sourceText: string,
  validationErrors: readonly ValidationError[]
): TranslationResponse["translations"][number] {
  return {
    entryId,
    targetLocale,
    translatedText: sourceText,
    translatedTextChecksum: createChecksum(sourceText),
    validationErrors: [...validationErrors]
  };
}

function createInvalidLiquidSyntaxError(
  message: string,
  options: PlaceholderProtectionOptions
): ValidationError {
  return ValidationErrorSchema.parse({
    errorCode: "invalid_liquid_syntax",
    message,
    severity: "error",
    sourceEntryId: options.sourceEntryId
  });
}

function createInvalidTranslationError(
  message: string,
  options: PlaceholderProtectionOptions
): ValidationError {
  return ValidationErrorSchema.parse({
    errorCode: "invalid_translation",
    message,
    severity: "error",
    sourceEntryId: options.sourceEntryId
  });
}

function createChecksum(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const responseText = await response.text();

  if (responseText.length === 0) {
    return {};
  }

  return JSON.parse(responseText);
}
