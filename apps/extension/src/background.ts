import type {
  ApiErrorResponse,
  ExtractedContentPayload,
  TransformResult
} from "@braze-ai-translator/schemas";

import {
  postCanvasTranslate,
  postTransform,
  type CanvasTranslateHeaders,
  type CanvasTranslateHttpResponse
} from "./backendClient.js";
import {
  findCanvasIdByName,
  getWrapTranslationContextMenuCreateProperties,
  shouldRetryWrapTranslationMessage,
  type BrazeCanvasListItem
} from "./backgroundShared.js";

const RUN_TRANSFORM_MESSAGE_TYPE = "braze-ai-translator/run-transform";
const TRANSLATE_CANVAS_MESSAGE_TYPE =
  "braze-ai-translator/translate-canvas";
const RESOLVE_CANVAS_ID_MESSAGE_TYPE =
  "braze-ai-translator/resolve-canvas-id";
const WRAP_TRANSLATION_TAG_MESSAGE_TYPE =
  "braze-ai-translator/wrap-translation-tag";
const TOGGLE_SETTINGS_PANEL_MESSAGE_TYPE =
  "braze-ai-translator/toggle-settings-panel";

interface TransformRequestMessage {
  readonly type: typeof RUN_TRANSFORM_MESSAGE_TYPE;
  readonly backendBaseUrl: string;
  readonly payload: ExtractedContentPayload;
}

interface TranslateCanvasRequestMessage {
  readonly type: typeof TRANSLATE_CANVAS_MESSAGE_TYPE;
  readonly backendBaseUrl: string;
  readonly canvasId?: string;
  readonly canvasName?: string;
  readonly headers: CanvasTranslateHeaders;
}

interface ResolveCanvasIdRequestMessage {
  readonly type: typeof RESOLVE_CANVAS_ID_MESSAGE_TYPE;
  readonly brazeRestApiUrl: string;
  readonly brazeApiKey: string;
  readonly canvasName: string;
}

interface TransformSuccessMessage {
  readonly ok: true;
  readonly result: TransformResult;
}

interface TransformFailureMessage {
  readonly ok: false;
  readonly message: string;
  readonly statusCode?: number;
  readonly apiError?: ApiErrorResponse;
  readonly responseBody?: unknown;
}

type BackgroundMessageResponse =
  | TransformSuccessMessage
  | TransformFailureMessage
  | CanvasTranslateHttpResponse
  | ResolveCanvasIdResponse
  | { readonly ok: boolean; readonly message?: string };

interface ResolveCanvasIdResponse {
  readonly ok: boolean;
  readonly canvasId?: string;
  readonly message?: string;
}

interface ChromeRuntimeMessageSender {}

interface ChromeContextMenusLike {
  removeAll(callback?: () => void): void;
  create(
    properties: Record<string, unknown>,
    callback?: () => void
  ): void;
  readonly onClicked: {
    addListener(
      callback: (
        info: {
          readonly menuItemId: string | number;
          readonly selectionText?: string;
          readonly frameId?: number;
        },
        tab?: { readonly id?: number }
      ) => void
    ): void;
  };
}

interface ChromeTabsLike {
  sendMessage(
    tabId: number,
    message: unknown,
    options?: { readonly frameId?: number },
    callback?: (response: unknown) => void
  ): void;
}

interface ChromeActionLike {
  readonly onClicked?: {
    addListener(callback: (tab: { readonly id?: number }) => void): void;
  };
}

interface ChromeRuntimeLike {
  readonly runtime: {
    readonly onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: ChromeRuntimeMessageSender,
          sendResponse: (response: BackgroundMessageResponse) => void
        ) => boolean | void
      ): void;
    };
    readonly onInstalled?: {
      addListener(callback: () => void): void;
    };
    readonly lastError?: {
      readonly message?: string;
    };
  };
  readonly contextMenus?: ChromeContextMenusLike;
  readonly tabs?: ChromeTabsLike;
  readonly action?: ChromeActionLike;
}

const extensionChrome = getExtensionChrome();

if (extensionChrome !== undefined) {
  const installContextMenu = (): void => {
    extensionChrome.contextMenus?.removeAll(() => {
      extensionChrome.contextMenus?.create(
        getWrapTranslationContextMenuCreateProperties()
      );
    });
  };

  installContextMenu();

  extensionChrome.runtime.onInstalled?.addListener(() => {
    installContextMenu();
  });

  extensionChrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (
      info.menuItemId === "braze-wrap-translation-tag" &&
      tab?.id !== undefined
    ) {
      const message = {
        type: WRAP_TRANSLATION_TAG_MESSAGE_TYPE,
        selectionText: info.selectionText ?? ""
      };

      if (info.frameId === undefined) {
        extensionChrome.tabs?.sendMessage(tab.id, message);
        return;
      }

      extensionChrome.tabs?.sendMessage(
        tab.id,
        message,
        { frameId: info.frameId },
        (_response) => {
          // Clear any lastError to avoid "unchecked runtime.lastError" warnings.
          // Do NOT retry without frameId -- that would broadcast to all frames
          // and open duplicate modals.
          void extensionChrome.runtime.lastError;
        }
      );
    }
  });

  extensionChrome.action?.onClicked?.addListener((tab) => {
    if (tab.id === undefined) {
      return;
    }

    extensionChrome.tabs?.sendMessage(tab.id, {
      type: TOGGLE_SETTINGS_PANEL_MESSAGE_TYPE
    });
  });

  extensionChrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (isTransformRequestMessage(message)) {
        void handleTransformRequest(message)
          .then(sendResponse)
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown extension error."
            })
          );

        return true;
      }

      if (isTranslateCanvasRequestMessage(message)) {
        void handleTranslateCanvasRequest(message)
          .then(sendResponse)
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown extension error."
            })
          );

        return true;
      }

      if (isResolveCanvasIdRequestMessage(message)) {
        void handleResolveCanvasIdRequest(message)
          .then(sendResponse)
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown extension error."
            })
          );

        return true;
      }

      return undefined;
    }
  );
}

async function handleTransformRequest(
  message: TransformRequestMessage
): Promise<TransformSuccessMessage | TransformFailureMessage> {
  return postTransform(message.backendBaseUrl, message.payload);
}

async function handleTranslateCanvasRequest(
  message: TranslateCanvasRequestMessage
): Promise<CanvasTranslateHttpResponse> {
  return postCanvasTranslate(
    message.backendBaseUrl,
    message.canvasId,
    message.headers,
    message.canvasName
  );
}

async function handleResolveCanvasIdRequest(
  message: ResolveCanvasIdRequestMessage
): Promise<ResolveCanvasIdResponse> {
  const normalizedBaseUrl = message.brazeRestApiUrl.replace(/\/+$/, "");
  const maxPages = 50;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${normalizedBaseUrl}/canvas/list`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("include_archived", "true");
    url.searchParams.set("sort_direction", "desc");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${message.brazeApiKey}`,
        "Content-Type": "application/json"
      }
    });

    const body = await parseJsonResponse(response);
    if (!response.ok) {
      return {
        ok: false,
        message: `Braze GET /canvas/list returned ${response.status}: ${JSON.stringify(body)}`
      };
    }

    const canvases = parseCanvasListItems(body);
    const canvasId = findCanvasIdByName(canvases, message.canvasName);
    if (canvasId) {
      return { ok: true, canvasId };
    }

    if (canvases.length === 0) {
      break;
    }
  }

  return {
    ok: false,
    message: `Could not find a canvas named "${message.canvasName}".`
  };
}

function isTransformRequestMessage(
  value: unknown
): value is TransformRequestMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === RUN_TRANSFORM_MESSAGE_TYPE &&
    typeof value.backendBaseUrl === "string" &&
    isRecord(value.payload)
  );
}

function isTranslateCanvasRequestMessage(
  value: unknown
): value is TranslateCanvasRequestMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === TRANSLATE_CANVAS_MESSAGE_TYPE &&
    typeof value.backendBaseUrl === "string" &&
    (typeof value.canvasId === "string" || typeof value.canvasName === "string") &&
    isRecord(value.headers)
  );
}

function isResolveCanvasIdRequestMessage(
  value: unknown
): value is ResolveCanvasIdRequestMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === RESOLVE_CANVAS_ID_MESSAGE_TYPE &&
    typeof value.brazeRestApiUrl === "string" &&
    typeof value.brazeApiKey === "string" &&
    typeof value.canvasName === "string"
  );
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

function parseCanvasListItems(value: unknown): readonly BrazeCanvasListItem[] {
  if (!isRecord(value) || !Array.isArray(value.canvases)) {
    return [];
  }

  return value.canvases.flatMap((canvas): BrazeCanvasListItem[] => {
    if (!isRecord(canvas)) {
      return [];
    }

    if (typeof canvas.id !== "string" || typeof canvas.name !== "string") {
      return [];
    }

    return [
      {
        id: canvas.id,
        name: canvas.name,
        tags: Array.isArray(canvas.tags)
          ? canvas.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        last_edited:
          typeof canvas.last_edited === "string" ? canvas.last_edited : undefined
      }
    ];
  });
}

function getExtensionChrome(): ChromeRuntimeLike | undefined {
  const globalChrome = (globalThis as typeof globalThis & {
    chrome?: ChromeRuntimeLike;
  }).chrome;

  return globalChrome;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
