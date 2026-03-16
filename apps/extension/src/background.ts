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

const RUN_TRANSFORM_MESSAGE_TYPE = "braze-ai-translator/run-transform";
const TRANSLATE_CANVAS_MESSAGE_TYPE =
  "braze-ai-translator/translate-canvas";
const WRAP_TRANSLATION_TAG_MESSAGE_TYPE =
  "braze-ai-translator/wrap-translation-tag";

interface TransformRequestMessage {
  readonly type: typeof RUN_TRANSFORM_MESSAGE_TYPE;
  readonly backendBaseUrl: string;
  readonly payload: ExtractedContentPayload;
}

interface TranslateCanvasRequestMessage {
  readonly type: typeof TRANSLATE_CANVAS_MESSAGE_TYPE;
  readonly backendBaseUrl: string;
  readonly canvasId: string;
  readonly headers: CanvasTranslateHeaders;
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
  | { readonly ok: boolean; readonly message?: string };

interface ChromeRuntimeMessageSender {}

interface ChromeContextMenusLike {
  create(
    properties: Record<string, unknown>,
    callback?: () => void
  ): void;
  readonly onClicked: {
    addListener(
      callback: (
        info: { readonly menuItemId: string | number; readonly selectionText?: string },
        tab?: { readonly id?: number }
      ) => void
    ): void;
  };
}

interface ChromeTabsLike {
  sendMessage(
    tabId: number,
    message: unknown,
    callback?: (response: unknown) => void
  ): void;
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
  };
  readonly contextMenus?: ChromeContextMenusLike;
  readonly tabs?: ChromeTabsLike;
}

const extensionChrome = getExtensionChrome();

if (extensionChrome !== undefined) {
  extensionChrome.runtime.onInstalled?.addListener(() => {
    extensionChrome.contextMenus?.create({
      id: "braze-wrap-translation-tag",
      title: "Wrap in translation tag",
      contexts: ["selection"],
      documentUrlPatterns: [
        "*://*.braze.com/*",
        "*://*.appboy.com/*",
        "*://*.braze.eu/*"
      ]
    });
  });

  extensionChrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (
      info.menuItemId === "braze-wrap-translation-tag" &&
      tab?.id !== undefined
    ) {
      extensionChrome.tabs?.sendMessage(tab.id, {
        type: WRAP_TRANSLATION_TAG_MESSAGE_TYPE,
        selectionText: info.selectionText ?? ""
      });
    }
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
    message.headers
  );
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
    typeof value.canvasId === "string" &&
    isRecord(value.headers)
  );
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
