import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { ZodError, type ZodType } from "zod";

import {
  ApiErrorResponseSchema,
  BrazeSyncRequestSchema,
  BrazeSyncResultSchema,
  ExtractedContentPayloadSchema,
  TransformResultSchema,
  TranslationRequestSchema,
  TranslationResponseSchema,
  ValidationErrorSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
  type BrazeSyncResult,
  type TransformResult,
  type TranslationResponse,
  type ValidationError
} from "@braze-ai-translator/schemas";

import {
  createDefaultProviders,
  MockTranslationProvider,
  type BackendProviders
} from "./providers.js";

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
      options.providers?.translationProvider ??
      defaultProviders.translationProvider,
    brazeSyncProvider:
      options.providers?.brazeSyncProvider ?? defaultProviders.brazeSyncProvider
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

    return sendApiError(
      reply,
      500,
      "internal_error",
      "The backend mock pipeline failed unexpectedly."
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

function createNowIsoTimestamp(): string {
  return new Date().toISOString();
}
