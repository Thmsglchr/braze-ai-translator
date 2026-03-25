import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { ZodError, type ZodType } from "zod";

import {
  ApiErrorResponseSchema,
  BrazeSyncRequestSchema,
  BrazeSyncResultSchema,
  CanvasTranslateRequestSchema,
  CanvasTranslateResponseSchema,
  CsvExportRequestSchema,
  CsvExportResponseSchema,
  CsvImportRequestSchema,
  CsvImportResponseSchema,
  ExtractedContentPayloadSchema,
  TemplateTranslateRequestSchema,
  TemplateTranslateResponseSchema,
  TransformResultSchema,
  TranslationRequestSchema,
  TranslationResponseSchema,
  ValidationErrorSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
  type BrazeSyncResult,
  type CanvasTranslateResponse,
  type CsvExportResponse,
  type CsvImportResponse,
  type TemplateTranslateResponse,
  type TransformResult,
  type TranslationResponse,
  type ValidationError
} from "@braze-ai-translator/schemas";

import {
  createDefaultProviders,
  MockTranslationProvider,
  OpenAITranslationProvider,
  type BackendProviders
} from "./providers.js";

import { BrazeCanvasClient } from "./providers/brazeCanvas.js";
import { CanvasTranslationWorkflowProvider } from "./providers/canvasTranslation.js";

export interface BackendAppOptions {
  readonly providers?: Partial<BackendProviders>;
  readonly now?: () => string;
  readonly logger?: boolean;
}

export function buildBackendApp(
  options: BackendAppOptions = {}
): FastifyInstance {
  const now = options.now ?? createNowIsoTimestamp;
  const defaultProviders = createDefaultProviders({ now });
  const providers: BackendProviders = {
    transformProvider:
      options.providers?.transformProvider ?? defaultProviders.transformProvider,
    translationProvider:
      options.providers?.translationProvider ?? defaultProviders.translationProvider,
    csvProvider:
      options.providers?.csvProvider ?? defaultProviders.csvProvider,
    brazeSyncProvider:
      options.providers?.brazeSyncProvider ?? defaultProviders.brazeSyncProvider,
    brazeTemplateClient:
      options.providers?.brazeTemplateClient ?? defaultProviders.brazeTemplateClient,
    templateTranslationProvider:
      options.providers?.templateTranslationProvider ??
      defaultProviders.templateTranslationProvider
  };
  const mockTranslationProvider = new MockTranslationProvider({ now });

  const app = Fastify({
    logger: options.logger ?? false
  });

  app.post("/transform", async (request, reply) => {
    const parsedBody = ExtractedContentPayloadSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return sendInvalidRequest(
        reply,
        "Request body must match the extracted content payload contract.",
        parsedBody.error
      );
    }

    return executeRoute<TransformResult>(
      reply,
      async () => providers.transformProvider.transform(parsedBody.data),
      TransformResultSchema
    );
  });

  app.post("/translate", async (request, reply) => {
    const parsedBody = TranslationRequestSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return sendInvalidRequest(
        reply,
        "Request body must match the translation request contract.",
        parsedBody.error
      );
    }

    return executeRoute<TranslationResponse>(
      reply,
      async () => providers.translationProvider.translate(parsedBody.data),
      TranslationResponseSchema
    );
  });

  app.post("/translate/mock", async (request, reply) => {
    const parsedBody = TranslationRequestSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return sendInvalidRequest(
        reply,
        "Request body must match the translation request contract.",
        parsedBody.error
      );
    }

    return executeRoute<TranslationResponse>(
      reply,
      async () => mockTranslationProvider.translate(parsedBody.data),
      TranslationResponseSchema
    );
  });

  app.post("/canvas/translate", async (request, reply) => {
    const parsedBody = CanvasTranslateRequestSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return sendInvalidRequest(
        reply,
        "Request body must match the canvas translate request contract.",
        parsedBody.error
      );
    }

    const headers = request.headers as Record<
      string,
      string | string[] | undefined
    >;
    const brazeApiKey = getHeader(headers, "x-braze-api-key");
    const brazeRestApiUrl = getHeader(headers, "x-braze-rest-api-url");
    const brazeSourceLocale = getHeader(headers, "x-braze-source-locale");
    const openaiApiKey = getHeader(headers, "x-openai-api-key");

    if (brazeApiKey === undefined || brazeRestApiUrl === undefined) {
      return sendApiError(
        reply,
        400,
        "invalid_request",
        "X-Braze-Api-Key and X-Braze-Rest-Api-Url headers are required."
      );
    }

    const canvasClient = new BrazeCanvasClient({
      apiKey: brazeApiKey,
      restApiBaseUrl: brazeRestApiUrl
    });

    const translationProv = openaiApiKey !== undefined
      ? new OpenAITranslationProvider({
          now,
          apiKey: openaiApiKey,
          model:
            getHeader(headers, "x-openai-model") ??
            process.env.OPENAI_MODEL ??
            "gpt-4.1-mini"
        })
      : providers.translationProvider;

    let resolvedCanvasId = parsedBody.data.canvasId;

    if (!resolvedCanvasId && parsedBody.data.canvasName) {
      const resolution = await canvasClient.resolveCanvasByName(
        parsedBody.data.canvasName
      );

      if (resolution.status === "matched") {
        resolvedCanvasId = resolution.canvasId;
      } else if (resolution.status === "ambiguous") {
        return sendApiError(
          reply,
          409,
          "invalid_request",
          `Found multiple canvases named "${parsedBody.data.canvasName}": ${resolution.matches
            .map((canvas) => canvas.id)
            .join(", ")}`
        );
      } else {
        return sendApiError(
          reply,
          404,
          "invalid_request",
          `Could not find a canvas named "${parsedBody.data.canvasName}". Please provide the canvas API identifier manually.`
        );
      }
    }

    if (!resolvedCanvasId) {
      return sendApiError(
        reply,
        400,
        "invalid_request",
        "Either canvasId or canvasName must be provided."
      );
    }

    const canvasWorkflow = new CanvasTranslationWorkflowProvider({
      now,
      translationProvider: translationProv,
      canvasClient,
      sourceLocale: brazeSourceLocale
    });

    return executeRoute<CanvasTranslateResponse>(
      reply,
      async () => canvasWorkflow.translateCanvas(resolvedCanvasId),
      CanvasTranslateResponseSchema
    );
  });

  app.post("/template/translate", async (request, reply) => {
    const parsedBody = TemplateTranslateRequestSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return sendInvalidRequest(
        reply,
        "Request body must match the template translate request contract.",
        parsedBody.error
      );
    }

    return executeRoute<TemplateTranslateResponse>(
      reply,
      async () =>
        providers.templateTranslationProvider.translateTemplate(parsedBody.data),
      TemplateTranslateResponseSchema
    );
  });

  app.post("/csv/export", async (request, reply) => {
    const parsedBody = CsvExportRequestSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return sendInvalidRequest(
        reply,
        "Request body must match the CSV export request contract.",
        parsedBody.error
      );
    }

    return executeRoute<CsvExportResponse>(
      reply,
      async () => providers.csvProvider.export(parsedBody.data),
      CsvExportResponseSchema
    );
  });

  app.post("/csv/import", async (request, reply) => {
    const parsedBody = CsvImportRequestSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return sendInvalidRequest(
        reply,
        "Request body must match the CSV import request contract.",
        parsedBody.error
      );
    }

    return executeRoute<CsvImportResponse>(
      reply,
      async () => providers.csvProvider.import(parsedBody.data),
      CsvImportResponseSchema
    );
  });

  app.post("/braze/mock-sync", async (request, reply) => {
    const parsedBody = BrazeSyncRequestSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return sendInvalidRequest(
        reply,
        "Request body must match the Braze mock sync request contract.",
        parsedBody.error
      );
    }

    return executeRoute<BrazeSyncResult>(
      reply,
      async () => providers.brazeSyncProvider.sync(parsedBody.data),
      BrazeSyncResultSchema
    );
  });

  return app;
}

async function executeRoute<TResponse>(
  reply: FastifyReply,
  handler: () => Promise<TResponse>,
  responseSchema: ZodType<TResponse>
): Promise<FastifyReply> {
  try {
    const payload = await handler();

    return sendValidatedResponse(reply, 200, responseSchema, payload);
  } catch (error) {
    if (error instanceof ZodError) {
      return sendApiError(
        reply,
        500,
        "internal_error",
        "Provider returned data that did not match the shared contract.",
        error.issues.map(convertZodIssueToValidationError)
      );
    }

    const errorMessage = extractErrorMessage(error);

    return sendApiError(
      reply,
      500,
      "internal_error",
      `Server error: ${errorMessage}`
    );
  }
}

function sendValidatedResponse<TResponse>(
  reply: FastifyReply,
  statusCode: number,
  schema: ZodType<TResponse>,
  payload: TResponse
): FastifyReply {
  const parsedPayload = schema.safeParse(payload);

  if (!parsedPayload.success) {
    return sendApiError(
      reply,
      500,
      "internal_error",
      "Response payload did not match the shared contract.",
      parsedPayload.error.issues.map(convertZodIssueToValidationError)
    );
  }

  return reply.code(statusCode).send(parsedPayload.data);
}

function sendInvalidRequest(
  reply: FastifyReply,
  message: string,
  error: ZodError
): FastifyReply {
  return sendApiError(
    reply,
    400,
    "invalid_request",
    message,
    error.issues.map(convertZodIssueToValidationError)
  );
}

function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  errorCode: ApiErrorCode,
  message: string,
  validationErrors: readonly ValidationError[] = []
): FastifyReply {
  const payload = ApiErrorResponseSchema.parse({
    errorCode,
    message,
    validationErrors: [...validationErrors]
  } satisfies ApiErrorResponse);

  return reply.code(statusCode).send(payload);
}

function convertZodIssueToValidationError(issue: ZodError["issues"][number]): ValidationError {
  return ValidationErrorSchema.parse({
    errorCode: "invalid_input",
    message: issue.message,
    severity: "error",
    fieldPathSegments: issue.path.length > 0 ? issue.path : undefined
  });
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name];

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (Array.isArray(value) && value.length > 0) {
    return value[0]?.trim();
  }

  return undefined;
}

function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown error";
  }

  const parts = [error.message];

  let current: unknown = (error as Error & { cause?: unknown }).cause;
  let depth = 0;
  while (current instanceof Error && depth < 5) {
    parts.push(current.message);
    current = (current as Error & { cause?: unknown }).cause;
    depth += 1;
  }

  return parts.join(" → ");
}

function createNowIsoTimestamp(): string {
  return new Date().toISOString();
}
