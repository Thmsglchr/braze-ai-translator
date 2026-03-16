import type {
  ApiErrorResponse,
  ExtractedContentPayload,
  TransformResult
} from "@braze-ai-translator/schemas";

export interface TransformSuccessResponse {
  readonly ok: true;
  readonly result: TransformResult;
}

export interface TransformFailureResponse {
  readonly ok: false;
  readonly message: string;
  readonly statusCode?: number;
  readonly apiError?: ApiErrorResponse;
  readonly responseBody?: unknown;
}

export type TransformHttpResponse =
  | TransformSuccessResponse
  | TransformFailureResponse;

export async function postTransform(
  backendBaseUrl: string,
  payload: ExtractedContentPayload,
  fetchFn: typeof fetch = fetch
): Promise<TransformHttpResponse> {
  const requestUrl = new URL("/transform", normalizeBaseUrl(backendBaseUrl));
  const response = await fetchFn(requestUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const responseBody = await parseJsonResponse(response);

  if (response.ok) {
    return {
      ok: true,
      result: responseBody as TransformResult
    };
  }

  const apiError = tryParseApiErrorResponse(responseBody);

  return {
    ok: false,
    message:
      apiError?.message ??
      `Transform request failed with status ${response.status}.`,
    statusCode: response.status,
    apiError,
    responseBody
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();

  if (trimmed.length === 0) {
    throw new Error("Backend URL must not be empty.");
  }

  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const responseText = await response.text();

  if (responseText.length === 0) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function tryParseApiErrorResponse(value: unknown): ApiErrorResponse | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (!Array.isArray(value.validationErrors)) {
    return undefined;
  }

  if (typeof value.errorCode !== "string" || typeof value.message !== "string") {
    return undefined;
  }

  return value as ApiErrorResponse;
}

export interface TemplateTranslateRequest {
  readonly templateId: string;
  readonly targetLocales: readonly string[];
}

export interface TemplateTranslateSuccessResponse {
  readonly ok: true;
  readonly result: Record<string, unknown>;
}

export interface TemplateTranslateFailureResponse {
  readonly ok: false;
  readonly message: string;
  readonly statusCode?: number;
  readonly apiError?: ApiErrorResponse;
  readonly responseBody?: unknown;
}

export type TemplateTranslateHttpResponse =
  | TemplateTranslateSuccessResponse
  | TemplateTranslateFailureResponse;

export interface TemplateTranslateHeaders {
  readonly brazeRestApiUrl?: string;
  readonly brazeApiKey?: string;
  readonly openaiApiKey?: string;
  readonly brazeSourceLocale?: string;
}

export async function postTemplateTranslate(
  backendBaseUrl: string,
  request: TemplateTranslateRequest,
  headers: TemplateTranslateHeaders,
  fetchFn: typeof fetch = fetch
): Promise<TemplateTranslateHttpResponse> {
  const requestUrl = new URL(
    "/template/translate",
    normalizeBaseUrl(backendBaseUrl)
  );

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (headers.brazeRestApiUrl) {
    requestHeaders["X-Braze-Rest-Api-Url"] = headers.brazeRestApiUrl;
  }

  if (headers.brazeApiKey) {
    requestHeaders["X-Braze-Api-Key"] = headers.brazeApiKey;
  }

  if (headers.openaiApiKey) {
    requestHeaders["X-OpenAI-Api-Key"] = headers.openaiApiKey;
  }

  if (headers.brazeSourceLocale) {
    requestHeaders["X-Braze-Source-Locale"] = headers.brazeSourceLocale;
  }

  const response = await fetchFn(requestUrl.toString(), {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(request)
  });
  const responseBody = await parseJsonResponse(response);

  if (response.ok) {
    return {
      ok: true,
      result: responseBody as Record<string, unknown>
    };
  }

  const apiError = tryParseApiErrorResponse(responseBody);

  return {
    ok: false,
    message:
      apiError?.message ??
      `Template translate request failed with status ${response.status}.`,
    statusCode: response.status,
    apiError,
    responseBody
  };
}

export interface GetTemplateTranslationsSuccessResponse {
  readonly ok: true;
  readonly result: unknown;
}

export interface GetTemplateTranslationsFailureResponse {
  readonly ok: false;
  readonly message: string;
}

export type GetTemplateTranslationsHttpResponse =
  | GetTemplateTranslationsSuccessResponse
  | GetTemplateTranslationsFailureResponse;

export async function getTemplateTranslations(
  backendBaseUrl: string,
  headers: {
    readonly brazeRestApiUrl: string;
    readonly brazeApiKey: string;
    readonly templateId: string;
  },
  fetchFn: typeof fetch = fetch
): Promise<GetTemplateTranslationsHttpResponse> {
  const requestUrl = new URL(
    "/templates/translations",
    normalizeBaseUrl(backendBaseUrl)
  );

  const response = await fetchFn(requestUrl.toString(), {
    method: "GET",
    headers: {
      "X-Braze-Rest-Api-Url": headers.brazeRestApiUrl,
      "X-Braze-Api-Key": headers.brazeApiKey,
      "X-Braze-Template-Id": headers.templateId
    }
  });
  const responseBody = await parseJsonResponse(response);

  if (response.ok) {
    return { ok: true, result: responseBody };
  }

  const apiError = tryParseApiErrorResponse(responseBody);

  return {
    ok: false,
    message:
      apiError?.message ??
      `Get template translations failed with status ${response.status}.`
  };
}

export interface BrazeTemplateListItem {
  readonly email_template_id: string;
  readonly template_name: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly tags: readonly string[];
}

export interface BrazeTemplateListResult {
  readonly templates: readonly BrazeTemplateListItem[];
  readonly count: number;
}

export interface ListTemplatesSuccessResponse {
  readonly ok: true;
  readonly result: BrazeTemplateListResult;
}

export interface ListTemplatesFailureResponse {
  readonly ok: false;
  readonly message: string;
}

export type ListTemplatesHttpResponse =
  | ListTemplatesSuccessResponse
  | ListTemplatesFailureResponse;

export async function getTemplatesList(
  backendBaseUrl: string,
  headers: Pick<TemplateTranslateHeaders, "brazeRestApiUrl" | "brazeApiKey">,
  fetchFn: typeof fetch = fetch
): Promise<ListTemplatesHttpResponse> {
  const requestUrl = new URL(
    "/templates/list",
    normalizeBaseUrl(backendBaseUrl)
  );

  const requestHeaders: Record<string, string> = {};

  if (headers.brazeRestApiUrl) {
    requestHeaders["X-Braze-Rest-Api-Url"] = headers.brazeRestApiUrl;
  }

  if (headers.brazeApiKey) {
    requestHeaders["X-Braze-Api-Key"] = headers.brazeApiKey;
  }

  const response = await fetchFn(requestUrl.toString(), {
    method: "GET",
    headers: requestHeaders
  });
  const responseBody = await parseJsonResponse(response);

  if (response.ok) {
    return {
      ok: true,
      result: responseBody as BrazeTemplateListResult
    };
  }

  const apiError = tryParseApiErrorResponse(responseBody);

  return {
    ok: false,
    message:
      apiError?.message ??
      `List templates request failed with status ${response.status}.`
  };
}

export interface CanvasTranslateHeaders {
  readonly brazeRestApiUrl: string;
  readonly brazeApiKey: string;
  readonly openaiApiKey?: string;
  readonly brazeSourceLocale?: string;
}

export interface CanvasTranslateSuccessResponse {
  readonly ok: true;
  readonly result: Record<string, unknown>;
}

export interface CanvasTranslateFailureResponse {
  readonly ok: false;
  readonly message: string;
  readonly statusCode?: number;
  readonly responseBody?: unknown;
}

export type CanvasTranslateHttpResponse =
  | CanvasTranslateSuccessResponse
  | CanvasTranslateFailureResponse;

export async function postCanvasTranslate(
  backendBaseUrl: string,
  canvasId: string,
  headers: CanvasTranslateHeaders,
  fetchFn: typeof fetch = fetch
): Promise<CanvasTranslateHttpResponse> {
  const requestUrl = new URL(
    "/canvas/translate",
    normalizeBaseUrl(backendBaseUrl)
  );

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Braze-Rest-Api-Url": headers.brazeRestApiUrl,
    "X-Braze-Api-Key": headers.brazeApiKey
  };

  if (headers.openaiApiKey) {
    requestHeaders["X-OpenAI-Api-Key"] = headers.openaiApiKey;
  }

  if (headers.brazeSourceLocale) {
    requestHeaders["X-Braze-Source-Locale"] = headers.brazeSourceLocale;
  }

  const response = await fetchFn(requestUrl.toString(), {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({ canvasId })
  });
  const responseBody = await parseJsonResponse(response);

  if (response.ok) {
    return {
      ok: true,
      result: responseBody as Record<string, unknown>
    };
  }

  const apiError = tryParseApiErrorResponse(responseBody);

  return {
    ok: false,
    message:
      apiError?.message ??
      `Canvas translate request failed with status ${response.status}.`,
    statusCode: response.status,
    responseBody
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
