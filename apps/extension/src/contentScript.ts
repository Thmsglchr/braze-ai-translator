type ApiErrorResponse =
  import("@braze-ai-translator/schemas").ApiErrorResponse;
type CanvasTranslateResponse =
  import("@braze-ai-translator/schemas").CanvasTranslateResponse;

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8787";
const DEFAULT_SOURCE_LOCALE = "en";

const BRAZE_REST_ENDPOINTS: readonly {
  readonly label: string;
  readonly url: string;
}[] = [
  { label: "US-01 (iad-01)", url: "https://rest.iad-01.braze.com" },
  { label: "US-02 (iad-02)", url: "https://rest.iad-02.braze.com" },
  { label: "US-03 (iad-03)", url: "https://rest.iad-03.braze.com" },
  { label: "US-04 (iad-04)", url: "https://rest.iad-04.braze.com" },
  { label: "US-05 (iad-05)", url: "https://rest.iad-05.braze.com" },
  { label: "US-06 (iad-06)", url: "https://rest.iad-06.braze.com" },
  { label: "US-07 (iad-07)", url: "https://rest.iad-07.braze.com" },
  { label: "US-08 (iad-08)", url: "https://rest.iad-08.braze.com" },
  { label: "EU-01 (fra-01)", url: "https://rest.fra-01.braze.eu" },
  { label: "EU-02 (fra-02)", url: "https://rest.fra-02.braze.eu" }
];

const TRANSLATE_CANVAS_MESSAGE_TYPE =
  "braze-ai-translator/translate-canvas";
const RESOLVE_CANVAS_ID_MESSAGE_TYPE =
  "braze-ai-translator/resolve-canvas-id";
const WRAP_TRANSLATION_TAG_MESSAGE_TYPE =
  "braze-ai-translator/wrap-translation-tag";
const TOGGLE_SETTINGS_PANEL_MESSAGE_TYPE =
  "braze-ai-translator/toggle-settings-panel";

interface CanvasTranslateResultMessage {
  readonly ok: boolean;
  readonly result?: CanvasTranslateResponse;
  readonly message?: string;
}

interface ResolveCanvasIdResultMessage {
  readonly ok: boolean;
  readonly canvasId?: string;
  readonly message?: string;
}

interface StoredSettings {
  readonly backendBaseUrl: string;
  readonly brazeRestApiUrl: string;
  readonly brazeApiKey: string;
  readonly openaiApiKey: string;
  readonly brazeSourceLocale: string;
}

type TagInsertionTarget =
  | {
      readonly kind: "form_control";
      readonly element: HTMLInputElement | HTMLTextAreaElement;
      readonly selectionStart: number;
      readonly selectionEnd: number;
      readonly selectedText: string;
    }
  | {
      readonly kind: "monaco";
      readonly editorElement: HTMLElement;
      readonly inputElement: HTMLTextAreaElement;
      readonly selectedText: string;
    }
  | {
      readonly kind: "contenteditable";
      readonly editableElement: HTMLElement;
      readonly range: Range;
      readonly selectedText: string;
    };

type ToastType = "success" | "error" | "info" | "warning";

const BRAZE_PURPLE = "#6826E1";
const BRAZE_PURPLE_HOVER = "#5b1fce";
const BRAZE_PURPLE_SURFACE = "#F0E8FD";
const BRAZE_PURPLE_BORDER = "#DCDCE4";
const BRAZE_TEXT = "#1A1A2E";
const BRAZE_MUTED = "#5C5C72";
const BRAZE_BORDER = "#DCDCE4";
const BRAZE_BORDER_LIGHT = "#EAEAF0";
const BRAZE_BG = "#F4F5F7";
const BRAZE_RADIUS_SM = "6px";
const BRAZE_RADIUS = "10px";
const BRAZE_RADIUS_LG = "14px";
const BRAZE_SHADOW = "0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)";
const BRAZE_SHADOW_MD = "0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08)";

interface ChromeStorageAreaLike {
  get(
    keys: string | string[] | Record<string, unknown>,
    callback: (items: Record<string, unknown>) => void
  ): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
}

interface ChromeRuntimeLike {
  sendMessage(
    message: unknown,
    callback: (response: unknown) => void
  ): void;
  onMessage?: {
    addListener(
      callback: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    ): void;
  };
  lastError?: {
    readonly message?: string;
  };
}

interface ChromeLike {
  readonly runtime: ChromeRuntimeLike & {
    getURL?(path: string): string;
  };
  readonly storage?: {
    readonly local: ChromeStorageAreaLike;
  };
}

const SETTINGS_DEFAULTS: StoredSettings = {
  backendBaseUrl: DEFAULT_BACKEND_URL,
  brazeRestApiUrl: BRAZE_REST_ENDPOINTS[0]?.url ?? "",
  brazeApiKey: "",
  openaiApiKey: "",
  brazeSourceLocale: DEFAULT_SOURCE_LOCALE
};

const extensionChrome = getExtensionChrome();
let pendingTagInsertionTarget: TagInsertionTarget | null = null;
let lastFocusedMonacoTextarea: HTMLTextAreaElement | null = null;
let tagInsertionInFlight = false;

const NORMALIZED_TRANSLATION_BLOCK_START = "{% translation";
const NORMALIZED_TRANSLATION_BLOCK_END = "{% endtranslation %}";

function getExtensionChrome(): ChromeLike | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome;
}

async function loadStoredSettings(): Promise<StoredSettings> {
  if (extensionChrome?.storage?.local === undefined) {
    return SETTINGS_DEFAULTS;
  }

  try {
    return await new Promise<StoredSettings>((resolve) => {
      extensionChrome.storage?.local.get(
        { ...SETTINGS_DEFAULTS } as Record<string, unknown>,
        (items) => {
          resolve({
            backendBaseUrl:
              typeof items.backendBaseUrl === "string"
                ? items.backendBaseUrl
                : SETTINGS_DEFAULTS.backendBaseUrl,
            brazeRestApiUrl:
              typeof items.brazeRestApiUrl === "string"
                ? items.brazeRestApiUrl
                : SETTINGS_DEFAULTS.brazeRestApiUrl,
            brazeApiKey:
              typeof items.brazeApiKey === "string"
                ? items.brazeApiKey
                : SETTINGS_DEFAULTS.brazeApiKey,
            openaiApiKey:
              typeof items.openaiApiKey === "string"
                ? items.openaiApiKey
                : SETTINGS_DEFAULTS.openaiApiKey,
            brazeSourceLocale:
              typeof items.brazeSourceLocale === "string"
                ? items.brazeSourceLocale
                : SETTINGS_DEFAULTS.brazeSourceLocale
          });
        }
      );
    });
  } catch {
    return SETTINGS_DEFAULTS;
  }
}

async function storeSettings(settings: StoredSettings): Promise<void> {
  if (extensionChrome?.storage?.local === undefined) {
    return;
  }

  try {
    await new Promise<void>((resolve) => {
      extensionChrome.storage?.local.set(
        {
          backendBaseUrl: settings.backendBaseUrl,
          brazeRestApiUrl: settings.brazeRestApiUrl,
          brazeApiKey: settings.brazeApiKey,
          openaiApiKey: settings.openaiApiKey,
          brazeSourceLocale: settings.brazeSourceLocale
        },
        () => resolve()
      );
    });
  } catch {
    // Storage unavailable
  }
}

function parseCanvasNameFromTitle(): string | null {
  const titleElement = document.querySelector("title");
  if (!titleElement) {
    return null;
  }

  const titleText = titleElement.textContent ?? "";

  // Pattern: "... Edit 'Canvas Name'" or "... Edit 'Canvas Name' ..."
  const editQuoteMatch = titleText.match(/Edit\s+'([^']+)'/i);
  if (editQuoteMatch?.[1]) {
    return editQuoteMatch[1].trim();
  }

  // Fallback: "... Edit \"Canvas Name\""
  const editDoubleQuoteMatch = titleText.match(/Edit\s+"([^"]+)"/i);
  if (editDoubleQuoteMatch?.[1]) {
    return editDoubleQuoteMatch[1].trim();
  }

  return null;
}

function isBrazePage(): boolean {
  if (frameElementLooksLikeBrazeEditor()) {
    return true;
  }

  const hosts = [
    window.location.hostname,
    getHostFromUrl(document.referrer)
  ];

  const ancestorOrigins = window.location.ancestorOrigins;
  if (ancestorOrigins !== undefined) {
    for (let index = 0; index < ancestorOrigins.length; index += 1) {
      const origin = ancestorOrigins[index];
      if (typeof origin === "string") {
        hosts.push(getHostFromUrl(origin));
      }
    }
  }

  return hosts.some((host) =>
    host.endsWith(".braze.com") ||
    host.endsWith(".appboy.com") ||
    host.endsWith(".braze.eu")
  );
}

function frameElementLooksLikeBrazeEditor(): boolean {
  try {
    const frameElement = window.frameElement;
    if (!(frameElement instanceof HTMLIFrameElement)) {
      return false;
    }

    const haystack = [
      frameElement.id,
      frameElement.name,
      frameElement.className,
      frameElement.getAttribute("title") ?? "",
      frameElement.getAttribute("src") ?? ""
    ]
      .join(" ")
      .toLowerCase();

    return (
      haystack.includes("dnd-editor-container__bee-plugin-frame") ||
      haystack.includes("bee-plugin-frame") ||
      haystack.includes("bee") ||
      haystack.includes("braze")
    );
  } catch {
    return false;
  }
}

function getHostFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function isTopLevelFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return true;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeMonacoRenderedText(value: string): string {
  return value.replaceAll("\u00a0", " ").replaceAll("\u200b", "");
}

function joinMonacoRenderedLines(lines: readonly string[]): string {
  return lines.map((line) => normalizeMonacoRenderedText(line)).join("\n");
}

function didMonacoContentChange(
  before: string,
  after: string,
  tagged: string
): boolean {
  if (before === after) {
    return false;
  }

  return normalizeMonacoRenderedText(after).includes(
    normalizeMonacoRenderedText(tagged)
  );
}

// ---------------------------------------------------------------------------
// Monaco Page Bridge (MAIN world communication)
// ---------------------------------------------------------------------------

const BRIDGE_GET_SELECTION = "braze-ai-monaco-get-selection";
const BRIDGE_SELECTION_RESULT = "braze-ai-monaco-selection-result";
const BRIDGE_REPLACE_SELECTION = "braze-ai-monaco-replace-selection";
const BRIDGE_REPLACE_RESULT = "braze-ai-monaco-replace-result";
const BRIDGE_READY = "braze-ai-monaco-bridge-ready";

let monacoBridgeReady = false;

function injectMonacoPageBridge(): void {
  if (document.getElementById("braze-ai-monaco-bridge-script")) {
    return;
  }

  const readyHandler = (): void => {
    monacoBridgeReady = true;
    window.removeEventListener(BRIDGE_READY, readyHandler);
  };
  window.addEventListener(BRIDGE_READY, readyHandler);

  const bridgeUrl = extensionChrome?.runtime.getURL?.(
    "dist/monacoPageBridge.js"
  );
  if (bridgeUrl) {
    const script = document.createElement("script");
    script.id = "braze-ai-monaco-bridge-script";
    script.src = bridgeUrl;
    (document.head ?? document.documentElement).appendChild(script);
    return;
  }

  // Fallback: inline injection (may be blocked by CSP)
  try {
    const script = document.createElement("script");
    script.id = "braze-ai-monaco-bridge-script";
    script.textContent = "/* bridge unavailable – inline fallback skipped */";
    (document.head ?? document.documentElement).appendChild(script);
  } catch {
    /* CSP blocked inline script */
  }
}

interface BridgeSelectionResult {
  readonly ok: boolean;
  readonly selectedText?: string;
  readonly fullText?: string;
  readonly hasSelection?: boolean;
  readonly error?: string;
}

interface BridgeReplaceResult {
  readonly ok: boolean;
  readonly error?: string;
}

function getMonacoSelectionViaBridge(): Promise<BridgeSelectionResult> {
  return new Promise<BridgeSelectionResult>((resolve) => {
    let resolved = false;

    const handler = (event: Event): void => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener(BRIDGE_SELECTION_RESULT, handler);
      try {
        resolve(
          JSON.parse(
            (event as CustomEvent<string>).detail as string
          ) as BridgeSelectionResult
        );
      } catch {
        resolve({ ok: false, error: "Failed to parse bridge response" });
      }
    };

    window.addEventListener(BRIDGE_SELECTION_RESULT, handler);
    window.dispatchEvent(new CustomEvent(BRIDGE_GET_SELECTION));

    window.setTimeout(() => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener(BRIDGE_SELECTION_RESULT, handler);
      resolve({ ok: false, error: "Bridge timeout" });
    }, 800);
  });
}

function replaceMonacoSelectionViaBridge(
  replacement: string
): Promise<BridgeReplaceResult> {
  return new Promise<BridgeReplaceResult>((resolve) => {
    let resolved = false;

    const handler = (event: Event): void => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener(BRIDGE_REPLACE_RESULT, handler);
      try {
        resolve(
          JSON.parse(
            (event as CustomEvent<string>).detail as string
          ) as BridgeReplaceResult
        );
      } catch {
        resolve({ ok: false, error: "Failed to parse bridge response" });
      }
    };

    window.addEventListener(BRIDGE_REPLACE_RESULT, handler);
    window.dispatchEvent(
      new CustomEvent(BRIDGE_REPLACE_SELECTION, {
        detail: JSON.stringify({ replacement })
      })
    );

    window.setTimeout(() => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener(BRIDGE_REPLACE_RESULT, handler);
      resolve({ ok: false, error: "Bridge timeout" });
    }, 800);
  });
}

// ---------------------------------------------------------------------------
// Tool 1: Translation Tag Inserter
// ---------------------------------------------------------------------------

function setupTagInserterListener(): void {
  extensionChrome?.runtime.onMessage?.addListener(
    (message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
      if (!isRecord(message)) return;

      if (message.type === TOGGLE_SETTINGS_PANEL_MESSAGE_TYPE) {
        toggleSettingsPanel();
        sendResponse({ ok: true });
        return;
      }

      if (message.type !== WRAP_TRANSLATION_TAG_MESSAGE_TYPE) return;

      if (pendingTagInsertionTarget === null) {
        pendingTagInsertionTarget = captureTagInsertionTarget();
      }

      const selectionTextFromMessage =
        typeof message.selectionText === "string"
          ? message.selectionText
          : "";
      const selectionText =
        pendingTagInsertionTarget?.selectedText ?? selectionTextFromMessage;

      if (selectionText.length > 0) {
        showTagIdModal(selectionText);
        sendResponse({ ok: true });
        return;
      }

      // Native selection was empty -- refocus Monaco and ask the bridge
      if (lastFocusedMonacoTextarea !== null) {
        lastFocusedMonacoTextarea.focus({ preventScroll: true });
      }
      void (async () => {
        // Small delay for Monaco to restore internal state after refocus
        await new Promise<void>((r) => window.setTimeout(r, 80));
        const bridgeResult = await getMonacoSelectionViaBridge();
        const text =
          bridgeResult.ok && bridgeResult.selectedText
            ? bridgeResult.selectedText
            : selectionTextFromMessage;
        showTagIdModal(text);
      })();
      sendResponse({ ok: true });
    }
  );
}

function setupTagInsertionTargetTracking(): void {
  const updatePendingTarget = (): void => {
    const target = captureTagInsertionTarget();
    if (target !== null) {
      pendingTagInsertionTarget = target;
    }

    // Always track the last Monaco textarea that had focus so we can
    // restore it after the modal steals focus.
    const active = document.activeElement;
    if (
      active instanceof HTMLTextAreaElement &&
      active.classList.contains("inputarea") &&
      getMonacoEditorElement(active) !== null
    ) {
      lastFocusedMonacoTextarea = active;
    }
  };

  document.addEventListener(
    "contextmenu",
    updatePendingTarget,
    true
  );
  document.addEventListener("selectionchange", updatePendingTarget, true);
  document.addEventListener("mouseup", updatePendingTarget, true);
  document.addEventListener("keyup", updatePendingTarget, true);
  document.addEventListener("focusin", updatePendingTarget, true);
}

function showTagIdModal(selectedText: string): void {
  const existing = document.getElementById(
    "braze-ai-tag-modal-backdrop"
  );
  if (existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "braze-ai-tag-modal-backdrop";
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "rgba(26, 26, 46, 0.28)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px"
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    background: "#fff",
    borderRadius: BRAZE_RADIUS_LG,
    border: `1px solid ${BRAZE_BORDER_LIGHT}`,
    padding: "24px",
    width: "min(560px, calc(100vw - 48px))",
    boxShadow: BRAZE_SHADOW_MD,
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: "14px",
    color: BRAZE_TEXT,
    display: "flex",
    flexDirection: "column",
    gap: "20px"
  });

  const preview = selectedText.length > 60
    ? selectedText.slice(0, 57) + "..."
    : selectedText;

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    gap: "18px"
  });

  const titleBlock = document.createElement("div");
  const title = document.createElement("div");
  title.textContent = "Wrap in translation tag";
  Object.assign(title.style, {
    fontSize: "18px",
    lineHeight: "1.2",
    fontWeight: "700",
    color: BRAZE_TEXT,
    letterSpacing: "-0.015em"
  });
  const subtitle = document.createElement("div");
  subtitle.textContent =
    "Choose the translation key that should wrap the selected Braze content.";
  Object.assign(subtitle.style, {
    marginTop: "6px",
    fontSize: "14px",
    lineHeight: "1.45",
    color: BRAZE_MUTED
  });
  titleBlock.appendChild(title);
  titleBlock.appendChild(subtitle);
  header.appendChild(titleBlock);

  const previewCard = document.createElement("div");
  Object.assign(previewCard.style, {
    borderRadius: BRAZE_RADIUS,
    padding: "12px 14px",
    background: BRAZE_BG,
    border: `1px solid ${BRAZE_BORDER_LIGHT}`
  });

  const previewLabel = document.createElement("div");
  previewLabel.textContent = "Selected text";
  Object.assign(previewLabel.style, {
    fontSize: "12px",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: BRAZE_MUTED,
    marginBottom: "8px"
  });

  const previewValue = document.createElement("div");
  previewValue.textContent = preview || "(no text)";
  Object.assign(previewValue.style, {
    fontSize: "14px",
    lineHeight: "1.5",
    color: BRAZE_TEXT,
    wordBreak: "break-word"
  });

  previewCard.appendChild(previewLabel);
  previewCard.appendChild(previewValue);

  const fieldGroup = document.createElement("div");
  Object.assign(fieldGroup.style, {
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  });

  const fieldLabel = document.createElement("label");
  fieldLabel.htmlFor = "braze-ai-tag-id-input";
  fieldLabel.textContent = "Translation ID";
  Object.assign(fieldLabel.style, {
    fontSize: "14px",
    fontWeight: "600",
    color: BRAZE_TEXT
  });

  const input = document.createElement("input");
  input.id = "braze-ai-tag-id-input";
  input.type = "text";
  input.placeholder = "e.g. headline, cta_button";
  Object.assign(input.style, {
    width: "100%",
    height: "52px",
    padding: "0 16px",
    border: `1px solid ${BRAZE_BORDER}`,
    borderRadius: BRAZE_RADIUS_SM,
    outline: "none",
    fontSize: "15px",
    color: BRAZE_TEXT,
    boxSizing: "border-box",
    transition: "border-color 0.18s ease, box-shadow 0.18s ease"
  });
  input.addEventListener("focus", () => {
    input.style.borderColor = BRAZE_PURPLE;
    input.style.boxShadow = "0 0 0 3px rgba(240, 232, 253, 1)";
  });
  input.addEventListener("blur", () => {
    input.style.borderColor = BRAZE_BORDER;
    input.style.boxShadow = "none";
  });
  input.addEventListener("input", () => {
    input.style.borderColor = BRAZE_BORDER;
    input.style.boxShadow = input === document.activeElement
      ? "0 0 0 3px rgba(240, 232, 253, 1)"
      : "none";
  });

  fieldGroup.appendChild(fieldLabel);
  fieldGroup.appendChild(input);

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
    marginTop: "4px",
    flexWrap: "wrap"
  });

  const cancelButton = document.createElement("button");
  cancelButton.id = "braze-ai-tag-cancel";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  Object.assign(cancelButton.style, {
    height: "40px",
    padding: "0 24px",
    borderRadius: BRAZE_RADIUS_SM,
    border: `1px solid ${BRAZE_PURPLE}`,
    background: "#fff",
    color: BRAZE_PURPLE,
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: "600",
    transition: "background 0.15s ease, border-color 0.15s ease"
  });
  cancelButton.addEventListener("mouseenter", () => {
    cancelButton.style.background = "#F5F5F8";
  });
  cancelButton.addEventListener("mouseleave", () => {
    cancelButton.style.background = "#fff";
  });

  const confirmButton = document.createElement("button");
  confirmButton.id = "braze-ai-tag-confirm";
  confirmButton.type = "button";
  confirmButton.textContent = "Insert tag";
  Object.assign(confirmButton.style, {
    height: "40px",
    padding: "0 28px",
    borderRadius: BRAZE_RADIUS_SM,
    border: `1px solid ${BRAZE_PURPLE}`,
    background: BRAZE_PURPLE,
    color: "#fff",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: "600",
    transition: "background 0.15s ease, border-color 0.15s ease"
  });
  confirmButton.addEventListener("mouseenter", () => {
    confirmButton.style.background = BRAZE_PURPLE_HOVER;
    confirmButton.style.borderColor = BRAZE_PURPLE_HOVER;
  });
  confirmButton.addEventListener("mouseleave", () => {
    confirmButton.style.background = BRAZE_PURPLE;
    confirmButton.style.borderColor = BRAZE_PURPLE;
  });

  actions.appendChild(cancelButton);
  actions.appendChild(confirmButton);

  modal.appendChild(header);
  modal.appendChild(previewCard);
  modal.appendChild(fieldGroup);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  input.focus();
  let didSubmit = false;

  const close = (clearPendingTarget = true): void => {
    if (clearPendingTarget) {
      pendingTagInsertionTarget = null;
    }
    backdrop.remove();
  };

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  cancelButton.addEventListener("click", () => close());

  const submit = (): void => {
    if (didSubmit) {
      return;
    }

    const tagId = input.value.trim();
    if (!tagId) {
      input.style.borderColor = "#df3341";
      input.style.boxShadow = "0 0 0 3px rgba(255, 240, 240, 1)";
      return;
    }

    didSubmit = true;
    confirmButton.disabled = true;
    confirmButton.style.opacity = "0.7";
    confirmButton.style.cursor = "default";
    close(false);
    window.setTimeout(() => {
      void insertTranslationTag(tagId, selectedText);
    }, 0);
  };

  confirmButton.addEventListener("click", submit);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") close();
  });
}

async function insertTranslationTag(
  tagId: string,
  selectedText: string
): Promise<void> {
  if (tagInsertionInFlight) {
    return;
  }
  tagInsertionInFlight = true;

  try {
  const savedTarget = pendingTagInsertionTarget;
  pendingTagInsertionTarget = null;

  // Refocus the Monaco textarea so the editor restores its internal selection
  // state (the modal stole focus).
  if (lastFocusedMonacoTextarea !== null) {
    lastFocusedMonacoTextarea.focus({ preventScroll: true });
    await new Promise<void>((r) => window.setTimeout(r, 80));
  }

  // Try the Monaco bridge first -- it handles the case where the DOM-based
  // capture couldn't read Monaco's internal selection state.
  const monacoOnPage = hasMonacoEditorOnPage();
  if (monacoBridgeReady && monacoOnPage) {
    const bridgeSel = await getMonacoSelectionViaBridge();
    if (bridgeSel.ok && bridgeSel.hasSelection && bridgeSel.selectedText) {
      const tagged = buildTranslationTag(tagId, bridgeSel.selectedText);
      const result = await replaceMonacoSelectionViaBridge(tagged);
      if (result.ok) {
        showToast("Inserted translation tag.", "success");
        return;
      }
      showToast(
        `Bridge replace failed: ${result.error ?? "unknown"}. Trying fallback...`,
        "warning"
      );
    } else if (!bridgeSel.ok) {
      // Show diagnostic so the user (and developer) can see what went wrong
      showToast(
        `Bridge: ${bridgeSel.error ?? "unknown error"}. Open DevTools console and run __brazeAiMonacoDiag() for details.`,
        "warning"
      );
    }

    // Bridge couldn't get selection or replace -- try with selectedText we already have
    if (
      !bridgeSel.ok &&
      selectedText.length > 0
    ) {
      const tagged = buildTranslationTag(tagId, selectedText);
      const result = await replaceMonacoSelectionViaBridge(tagged);
      if (result.ok) {
        showToast("Inserted translation tag.", "success");
        return;
      }
    }
  } else if (monacoOnPage && !monacoBridgeReady) {
    showToast(
      "Monaco bridge not ready. The bridge script may have failed to load. Check DevTools console for errors.",
      "warning"
    );
  }

  const exactSelectedText =
    savedTarget?.selectedText.length && savedTarget.selectedText !== selectedText
      ? savedTarget.selectedText
      : selectedText;

  if (exactSelectedText.length === 0) {
    showToast(
      "Select some text in the Braze editor before wrapping it in a translation tag.",
      "error"
    );
    return;
  }

  const tagged = buildTranslationTag(tagId, exactSelectedText);

  if (savedTarget !== null) {
    const inserted = await writeTranslationTagToTarget(savedTarget, tagged);

    if (inserted) {
      showToast("Inserted translation tag.", "success");
      return;
    }
  }

  const fallbackTarget = captureTagInsertionTarget();
  if (fallbackTarget !== null) {
    const inserted = await writeTranslationTagToTarget(fallbackTarget, tagged);

    if (inserted) {
      showToast("Inserted translation tag.", "success");
      return;
    }
  }

  if (replaceSelectedTextInDomFallback(exactSelectedText, tagged)) {
    showToast("Inserted translation tag.", "success");
    return;
  }

  if (replaceSelectedTextInBeeIframeFallback(exactSelectedText, tagged)) {
    showToast("Inserted translation tag.", "success");
    return;
  }

  // Last resort: copy to clipboard so the user can paste manually
  await copyTagToClipboardFallback(tagged);
  } finally {
    tagInsertionInFlight = false;
  }
}

async function copyTagToClipboardFallback(tagged: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(tagged);
    showToast(
      "Could not write directly to editor. Tagged text copied to clipboard — paste it manually (Ctrl+V / Cmd+V).",
      "warning"
    );
  } catch {
    showToast(
      "Could not insert tag. Copy this manually: " + tagged,
      "error"
    );
  }
}

function hasMonacoEditorOnPage(): boolean {
  return document.querySelector(".monaco-editor") !== null;
}

function buildTranslationTag(tagId: string, selectedText: string): string {
  return `{% translation ${tagId} %}${selectedText}{% endtranslation %}`;
}

async function writeTranslationTagToTarget(
  target: TagInsertionTarget,
  tagged: string
): Promise<boolean> {
  if (target.kind === "form_control") {
    return writeTranslationTagToFormControl(target, tagged);
  }

  if (target.kind === "monaco") {
    return writeTranslationTagToMonacoEditor(target, tagged);
  }

  return writeTranslationTagToEditableRange(target, tagged);
}

function captureTagInsertionTarget(): TagInsertionTarget | null {
  const selection = window.getSelection();
  const selectedTextFromSelection = getSelectedTextFromWindowSelection(selection);
  const activeElement = document.activeElement;

  if (activeElement instanceof HTMLTextAreaElement) {
    const monacoTarget = captureMonacoTargetFromInput(
      activeElement,
      selectedTextFromSelection
    );
    if (monacoTarget !== null) {
      return monacoTarget;
    }
  }

  if (
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLInputElement
  ) {
    const selectionStart = activeElement.selectionStart;
    const selectionEnd = activeElement.selectionEnd;

    if (
      selectionStart !== null &&
      selectionEnd !== null &&
      selectionEnd > selectionStart
    ) {
      return {
        kind: "form_control",
        element: activeElement,
        selectionStart,
        selectionEnd,
        selectedText: activeElement.value.slice(selectionStart, selectionEnd)
      };
    }
  }

  if (
    selection === null ||
    selection.rangeCount === 0 ||
    selection.isCollapsed
  ) {
    return null;
  }

  const selectedText = selectedTextFromSelection;
  if (selectedText.length === 0) {
    return null;
  }

  const range = selection.getRangeAt(0).cloneRange();
  const monacoTarget = captureMonacoTarget(range.commonAncestorContainer, selectedText);
  if (monacoTarget !== null) {
    return monacoTarget;
  }
  const editableElement = getEditableElement(range.commonAncestorContainer);

  if (editableElement === null) {
    return null;
  }

  return {
    kind: "contenteditable",
    editableElement,
    range,
    selectedText
  };
}

function getEditableElement(node: Node): HTMLElement | null {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : node.parentElement;

  while (current !== null) {
    if (current.isContentEditable) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function getSelectedTextFromWindowSelection(
  selection: Selection | null
): string {
  if (
    selection === null ||
    selection.rangeCount === 0 ||
    selection.isCollapsed
  ) {
    return "";
  }

  return normalizeMonacoRenderedText(selection.toString());
}

function captureMonacoTargetFromInput(
  inputElement: HTMLTextAreaElement,
  selectedText: string
): Extract<TagInsertionTarget, { readonly kind: "monaco" }> | null {
  const editorElement = getMonacoEditorElement(inputElement);
  if (editorElement === null || selectedText.length === 0) {
    return null;
  }

  return {
    kind: "monaco",
    editorElement,
    inputElement,
    selectedText
  };
}

function captureMonacoTarget(
  node: Node,
  selectedText: string
): Extract<TagInsertionTarget, { readonly kind: "monaco" }> | null {
  const editorElement = getMonacoEditorElement(node);
  if (editorElement === null || selectedText.length === 0) {
    return null;
  }

  const inputElement = editorElement.querySelector("textarea.inputarea");
  if (!(inputElement instanceof HTMLTextAreaElement)) {
    return null;
  }

  return {
    kind: "monaco",
    editorElement,
    inputElement,
    selectedText
  };
}

function getMonacoEditorElement(node: Node): HTMLElement | null {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : node.parentElement;

  while (current !== null) {
    if (
      current.classList.contains("monaco-editor") ||
      current.classList.contains("monaco-textarea")
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function readMonacoEditorText(editorElement: HTMLElement): string {
  const renderedLines = Array.from(
    editorElement.querySelectorAll(".view-line")
  ).map((line) => line.textContent ?? "");

  if (renderedLines.length > 0) {
    return joinMonacoRenderedLines(renderedLines);
  }

  return normalizeMonacoRenderedText(editorElement.textContent ?? "");
}

async function readMonacoEditorTextAfterTick(
  editorElement: HTMLElement,
  textBefore: string
): Promise<string> {
  const afterAnimationFrame = await waitForNextAnimationFrame();
  const textAfterAnimationFrame = readMonacoEditorText(editorElement);
  if (textAfterAnimationFrame !== textBefore) {
    return textAfterAnimationFrame;
  }

  await waitForMacrotask();
  return readMonacoEditorText(editorElement);
}

function waitForNextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function waitForMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function dispatchMonacoPasteEvent(
  inputElement: HTMLTextAreaElement,
  tagged: string
): boolean {
  if (
    typeof ClipboardEvent !== "function" ||
    typeof DataTransfer !== "function"
  ) {
    return false;
  }

  try {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", tagged);

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData
    });

    inputElement.dispatchEvent(pasteEvent);
    return true;
  } catch {
    return false;
  }
}

function writeTranslationTagToFormControl(
  target: Extract<TagInsertionTarget, { readonly kind: "form_control" }>,
  tagged: string
): boolean {
  try {
    const valueBefore = target.element.value;
    target.element.focus();
    target.element.setSelectionRange(
      target.selectionStart,
      target.selectionEnd
    );

    if (typeof target.element.setRangeText === "function") {
      target.element.setRangeText(
        tagged,
        target.selectionStart,
        target.selectionEnd,
        "select"
      );
    } else {
      const value = target.element.value;
      target.element.value =
        value.slice(0, target.selectionStart) +
        tagged +
        value.slice(target.selectionEnd);
      target.element.selectionStart = target.selectionStart;
      target.element.selectionEnd = target.selectionStart + tagged.length;
    }

    dispatchEditorChangeEvents(target.element);
    return target.element.value !== valueBefore;
  } catch {
    return false;
  }
}

async function writeTranslationTagToMonacoEditor(
  target: Extract<TagInsertionTarget, { readonly kind: "monaco" }>,
  tagged: string
): Promise<boolean> {
  // Primary path: use the MAIN-world bridge which can access editor.executeEdits()
  if (monacoBridgeReady) {
    const bridgeResult = await replaceMonacoSelectionViaBridge(tagged);
    if (bridgeResult.ok) {
      return true;
    }
  }

  // Fallback: DOM-based strategies (rarely work, but kept for completeness)
  const textBefore = readMonacoEditorText(target.editorElement);

  try {
    target.inputElement.focus({ preventScroll: true });

    if (dispatchMonacoPasteEvent(target.inputElement, tagged)) {
      const pastedText = await readMonacoEditorTextAfterTick(
        target.editorElement,
        textBefore
      );
      if (didMonacoContentChange(textBefore, pastedText, tagged)) {
        return true;
      }
    }

    if (document.queryCommandSupported?.("insertText")) {
      const inserted = document.execCommand("insertText", false, tagged);
      const textAfter = await readMonacoEditorTextAfterTick(
        target.editorElement,
        textBefore
      );

      if (
        inserted &&
        didMonacoContentChange(textBefore, textAfter, tagged)
      ) {
        return true;
      }
    }

    const selectionStart = target.inputElement.selectionStart;
    const selectionEnd = target.inputElement.selectionEnd;
    if (
      selectionStart !== null &&
      selectionEnd !== null &&
      selectionEnd >= selectionStart &&
      typeof target.inputElement.setRangeText === "function"
    ) {
      target.inputElement.setRangeText(
        tagged,
        selectionStart,
        selectionEnd,
        "end"
      );
      dispatchEditorChangeEvents(target.inputElement);

      const textAfter = await readMonacoEditorTextAfterTick(
        target.editorElement,
        textBefore
      );
      if (didMonacoContentChange(textBefore, textAfter, tagged)) {
        return true;
      }
    }

    dispatchEditorChangeEvents(target.inputElement);
    return didMonacoContentChange(
      textBefore,
      await readMonacoEditorTextAfterTick(target.editorElement, textBefore),
      tagged
    );
  } catch {
    return false;
  }
}

function writeTranslationTagToEditableRange(
  target: Extract<TagInsertionTarget, { readonly kind: "contenteditable" }>,
  tagged: string
): boolean {
  try {
    const ownerDocument = target.editableElement.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const htmlBefore = target.editableElement.innerHTML;

    // Attempt 1: Use the captured Range first so repeated text in the same
    // editable block does not wrap the wrong occurrence.
    const selection = ownerWindow?.getSelection() ?? window.getSelection();
    if (selection !== null) {
      target.editableElement.focus();
      selection.removeAllRanges();
      const range = target.range.cloneRange();
      selection.addRange(range);
      range.deleteContents();
      const textNode = ownerDocument.createTextNode(tagged);
      range.insertNode(textNode);

      const collapsedRange = ownerDocument.createRange();
      collapsedRange.setStartAfter(textNode);
      collapsedRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(collapsedRange);

      if (target.editableElement.innerHTML !== htmlBefore) {
        dispatchEditorChangeEvents(target.editableElement);
        return true;
      }
    }

    // Attempt 2: Direct text-node replacement as a fallback when the saved
    // range no longer maps cleanly to the live editor DOM.
    if (replaceSelectedTextInEditableElement(target, tagged, htmlBefore)) {
      return true;
    }

    // We intentionally do NOT use document.execCommand("insertText") here.
    // TinyMCE (used in Braze's drag-and-drop editor) intercepts the native
    // beforeinput event fired by execCommand and inserts the text via its
    // own API, while the browser also performs the native insertion --
    // resulting in the text appearing twice.

    return false;
  } catch {
    return false;
  }
}

function replaceSelectedTextInEditableElement(
  target: Extract<TagInsertionTarget, { readonly kind: "contenteditable" }>,
  tagged: string,
  htmlBefore: string
): boolean {
  const walker = target.editableElement.ownerDocument.createTreeWalker(
    target.editableElement,
    NodeFilter.SHOW_TEXT
  );

  while (true) {
    const currentNode = walker.nextNode();
    if (!(currentNode instanceof Text)) {
      break;
    }

    const currentValue = currentNode.data;
    const matchIndex = currentValue.indexOf(target.selectedText);
    if (matchIndex < 0) {
      continue;
    }

    currentNode.data =
      currentValue.slice(0, matchIndex) +
      tagged +
      currentValue.slice(matchIndex + target.selectedText.length);

    if (target.editableElement.innerHTML !== htmlBefore) {
      dispatchEditorChangeEvents(target.editableElement);
      return true;
    }
  }

  return false;
}

function replaceSelectedTextInDomFallback(
  selectedText: string,
  tagged: string
): boolean {
  if (selectedText.length === 0) {
    return false;
  }

  const candidateRoots = findDomReplacementRoots(selectedText);
  for (const root of candidateRoots) {
    if (replaceSelectedTextInTextNodes(root, selectedText, tagged)) {
      dispatchEditorChangeEvents(root);
      return true;
    }
  }

  return false;
}

function replaceSelectedTextInBeeIframeFallback(
  selectedText: string,
  tagged: string
): boolean {
  const beeDocument = getBeeIframeDocument();
  if (beeDocument === null) {
    return false;
  }

  const candidateRoots = findDomReplacementRootsInDocument(beeDocument, selectedText);
  for (const root of candidateRoots) {
    if (replaceSelectedTextInTextNodes(root, selectedText, tagged)) {
      dispatchEditorChangeEvents(root);
      return true;
    }
  }

  return false;
}

function getBeeIframeDocument(): Document | null {
  if (!isTopLevelFrame()) {
    return null;
  }

  const beeIframe = document.getElementById(
    "dnd-editor-container__bee-plugin-frame"
  );
  if (!(beeIframe instanceof HTMLIFrameElement)) {
    return null;
  }

  try {
    return beeIframe.contentDocument;
  } catch {
    return null;
  }
}

function findDomReplacementRoots(selectedText: string): HTMLElement[] {
  return findDomReplacementRootsInDocument(document, selectedText);
}

function findDomReplacementRootsInDocument(
  rootDocument: Document,
  selectedText: string
): HTMLElement[] {
  const selector = [
    "[contenteditable='true']",
    "[data-qa='tinyeditor-root-element']",
    "[role='textbox']",
    ".bee-plugin",
    ".bee-editor",
    ".bee-content",
    ".ProseMirror",
    ".public-DraftEditor-content"
  ].join(", ");
  const roots = new Set<HTMLElement>();
  const normalizedSelectedText = normalizeMonacoRenderedText(selectedText);

  for (const element of Array.from(rootDocument.querySelectorAll(selector))) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }

    const textContent = normalizeMonacoRenderedText(element.textContent ?? "");
    if (textContent.includes(normalizedSelectedText)) {
      roots.add(element);
    }
  }

  if (roots.size === 0) {
    const bodyText = normalizeMonacoRenderedText(rootDocument.body?.textContent ?? "");
    if (bodyText.includes(normalizedSelectedText)) {
      if (rootDocument.body instanceof HTMLElement) {
        roots.add(rootDocument.body);
      }
    }
  }

  return Array.from(roots).sort((left, right) => {
    const leftLength = (left.textContent ?? "").length;
    const rightLength = (right.textContent ?? "").length;
    return leftLength - rightLength;
  });
}

function replaceSelectedTextInTextNodes(
  root: HTMLElement,
  selectedText: string,
  tagged: string
): boolean {
  const ownerDocument = root.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const textNodes = collectTextNodes(root);
  if (textNodes.length === 0) {
    return false;
  }

  const rangeMatch = findNormalizedTextRangeInTextNodes(textNodes, selectedText);
  if (rangeMatch === null) {
    return false;
  }

  const startNode = textNodes[rangeMatch.startNodeIndex];
  const endNode = textNodes[rangeMatch.endNodeIndex];
  if (!(startNode instanceof Text) || !(endNode instanceof Text)) {
    return false;
  }

  const range = ownerDocument.createRange();
  range.setStart(startNode, rangeMatch.startOffset);
  range.setEnd(endNode, rangeMatch.endOffset);
  range.deleteContents();
  const insertedNode = ownerDocument.createTextNode(tagged);
  range.insertNode(insertedNode);
  range.setStartAfter(insertedNode);
  range.collapse(true);

  const selection = ownerWindow?.getSelection() ?? window.getSelection();
  if (selection !== null) {
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return true;
}

function findRawSubstringMatch(
  source: string,
  normalizedNeedle: string,
  normalizedStartIndex: number
): { readonly start: number; readonly end: number } | null {
  let normalizedIndex = 0;
  let rawStart = -1;

  for (let rawIndex = 0; rawIndex < source.length; rawIndex += 1) {
    const normalizedChar = normalizeMonacoRenderedText(source[rawIndex] ?? "");
    if (normalizedChar.length === 0) {
      continue;
    }

    if (normalizedIndex === normalizedStartIndex && rawStart < 0) {
      rawStart = rawIndex;
    }

    normalizedIndex += normalizedChar.length;

    if (
      rawStart >= 0 &&
      normalizedIndex >= normalizedStartIndex + normalizedNeedle.length
    ) {
      return { start: rawStart, end: rawIndex + 1 };
    }
  }

  return null;
}

function collectTextNodes(root: HTMLElement): Text[] {
  const textNodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  while (true) {
    const currentNode = walker.nextNode();
    if (!(currentNode instanceof Text)) {
      break;
    }
    textNodes.push(currentNode);
  }

  return textNodes;
}

function findNormalizedTextRangeInTextNodes(
  textNodes: readonly Text[],
  selectedText: string
): {
  readonly startNodeIndex: number;
  readonly startOffset: number;
  readonly endNodeIndex: number;
  readonly endOffset: number;
} | null {
  const normalizedSelectedText = normalizeMonacoRenderedText(selectedText);
  if (normalizedSelectedText.length === 0) {
    return null;
  }

  const normalizedHaystack = textNodes
    .map((node) => normalizeMonacoRenderedText(node.data))
    .join("");
  const normalizedStartIndex =
    findNormalizedMatchOutsideTranslationTagsInNormalizedSource(
      normalizedHaystack,
      normalizedSelectedText
    );
  if (normalizedStartIndex < 0) {
    return null;
  }

  let consumed = 0;
  let startNodeIndex = -1;
  let startOffset = -1;

  for (let nodeIndex = 0; nodeIndex < textNodes.length; nodeIndex += 1) {
    const nodeValue = textNodes[nodeIndex]?.data ?? "";
    for (let rawIndex = 0; rawIndex < nodeValue.length; rawIndex += 1) {
      const normalizedChar = normalizeMonacoRenderedText(nodeValue[rawIndex] ?? "");
      if (normalizedChar.length === 0) {
        continue;
      }

      if (consumed === normalizedStartIndex && startNodeIndex < 0) {
        startNodeIndex = nodeIndex;
        startOffset = rawIndex;
      }

      consumed += normalizedChar.length;

      if (
        startNodeIndex >= 0 &&
        consumed >= normalizedStartIndex + normalizedSelectedText.length
      ) {
        return {
          startNodeIndex,
          startOffset,
          endNodeIndex: nodeIndex,
          endOffset: rawIndex + 1
        };
      }
    }
  }

  return null;
}

function findNormalizedMatchOutsideTranslationTagsInNormalizedSource(
  normalizedSource: string,
  normalizedSelectedText: string
): number {
  const wrappedRanges =
    findNormalizedTranslationContentRanges(normalizedSource);
  let searchStartIndex = 0;

  while (true) {
    const matchIndex = normalizedSource.indexOf(
      normalizedSelectedText,
      searchStartIndex
    );
    if (matchIndex < 0) {
      return -1;
    }

    const matchEndIndex = matchIndex + normalizedSelectedText.length;
    const isWrapped = wrappedRanges.some(
      (range) => matchIndex >= range.start && matchEndIndex <= range.end
    );
    if (!isWrapped) {
      return matchIndex;
    }

    searchStartIndex = matchIndex + 1;
  }
}

function findNormalizedTranslationContentRanges(
  normalizedSource: string
): ReadonlyArray<{ readonly start: number; readonly end: number }> {
  const ranges: Array<{ readonly start: number; readonly end: number }> = [];
  let searchIndex = 0;

  while (true) {
    const blockStartIndex = normalizedSource.indexOf(
      NORMALIZED_TRANSLATION_BLOCK_START,
      searchIndex
    );
    if (blockStartIndex < 0) {
      break;
    }

    const openTagEndIndex = normalizedSource.indexOf("%}", blockStartIndex);
    if (openTagEndIndex < 0) {
      break;
    }

    const contentStartIndex = openTagEndIndex + 2;
    const blockEndIndex = normalizedSource.indexOf(
      NORMALIZED_TRANSLATION_BLOCK_END,
      contentStartIndex
    );
    if (blockEndIndex < 0) {
      break;
    }

    ranges.push({ start: contentStartIndex, end: blockEndIndex });
    searchIndex = blockEndIndex + NORMALIZED_TRANSLATION_BLOCK_END.length;
  }

  return ranges;
}

function dispatchEditorChangeEvents(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLElement
): void {
  const ownerWindow = element.ownerDocument.defaultView;
  const InputEventCtor = ownerWindow?.InputEvent;
  const EventCtor = ownerWindow?.Event ?? Event;

  // Notify frameworks that the content changed.  We intentionally do NOT
  // dispatch a beforeinput with inputType "insertText" and data, because
  // TinyMCE (used in the Braze d&d editor) interprets that as a *new*
  // insertion command and duplicates the text.
  if (typeof InputEventCtor === "function") {
    element.dispatchEvent(
      new InputEventCtor("input", {
        bubbles: true,
        inputType: "insertText"
      })
    );
  } else {
    element.dispatchEvent(new EventCtor("input", { bubbles: true }));
  }
  element.dispatchEvent(new EventCtor("change", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Tool 2: Canvas Translate Button
// ---------------------------------------------------------------------------

function tryInjectTranslateButton(): void {
  const existingButton = document.getElementById(
    "braze-ai-translate-canvas-button"
  );
  if (existingButton !== null) {
    return;
  }

  const testButton = findCanvasTestButton();
  if (!testButton) return;

  const wrapper = document.createElement("div");
  wrapper.id = "braze-ai-translate-canvas-wrapper";
  wrapper.className = "StyledButtonWrapper-sc-193l6tp-0 hpQzVB bcl-button__disabled-wrapper";

  const btn = document.createElement("button");
  btn.id = "braze-ai-translate-canvas-button";
  btn.setAttribute("data-is-loading", "false");
  btn.setAttribute("data-loading-state", "idle");
  btn.className = testButton.className;
  btn.type = "button";
  btn.innerHTML = `<span class="${getButtonContentClass(testButton)}"><span class="${getButtonIconClass(testButton)}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.545 6.714 4.11 8H3l1.862-5h1.284L8 8H6.833l-.435-1.286zm1.634-.736L5.5 3.956h-.049l-.679 2.022z"></path><path d="M0 2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm7.138 9.995q.289.451.63.846c-.748.575-1.673 1.001-2.768 1.292.178.217.451.635.555.867 1.125-.359 2.08-.844 2.886-1.494.777.665 1.739 1.165 2.93 1.472.133-.254.414-.673.629-.89-1.125-.253-2.057-.694-2.82-1.284.681-.747 1.222-1.651 1.621-2.757H14V8h-3v1.047h.765c-.318.844-.74 1.546-1.272 2.13a6 6 0 0 1-.415-.492 2 2 0 0 1-.94.31"></path></svg></span><span>Translate Canvas</span></span>`;

  btn.addEventListener("click", () => {
    void handleTranslateCanvasClick(btn);
  });

  wrapper.appendChild(btn);

  const parentWrapper = testButton.closest(
    ".StyledButtonWrapper-sc-193l6tp-0"
  );
  if (parentWrapper?.parentElement) {
    parentWrapper.parentElement.insertBefore(
      wrapper,
      parentWrapper.nextSibling
    );
  } else {
    testButton.parentElement?.insertBefore(wrapper, testButton.nextSibling);
  }
}

function findCanvasTestButton(): HTMLButtonElement | null {
  const directSelectors = [
    "button.canvas-btn-test-canvas",
    "button[data-qa='canvas-test-button']",
    "button[aria-label*='Test Canvas' i]"
  ];

  for (const selector of directSelectors) {
    const match = document.querySelector(selector);
    if (match instanceof HTMLButtonElement) {
      return match;
    }
  }

  const buttons = Array.from(document.querySelectorAll("button"));
  for (const button of buttons) {
    const normalizedText = normalizeButtonText(button.textContent ?? "");
    if (
      normalizedText === "test canvas" ||
      normalizedText.startsWith("test canvas ")
    ) {
      return button;
    }
  }

  return null;
}

function normalizeButtonText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function getButtonContentClass(reference: Element): string {
  const span = reference.querySelector("span[class*='ButtonContent']");
  return span?.className ?? "";
}

function getButtonIconClass(reference: Element): string {
  const iconSpan = reference.querySelector("span[class*='Icon']");
  return iconSpan?.className ?? "";
}

async function handleTranslateCanvasClick(
  btn: HTMLButtonElement
): Promise<void> {
  const settings = await loadStoredSettings();

  if (!settings.brazeApiKey || !settings.brazeRestApiUrl) {
    showToast(
      "Configure Braze API key and endpoint in the extension settings first.",
      "error"
    );
    return;
  }

  const originalText = btn.querySelector("span:last-child")?.textContent ?? "";
  const lastSpan = btn.querySelector("span:last-child");
  let progressModal: { readonly close: () => void } | null = null;

  try {
    const canvasName = parseCanvasNameFromTitle();
    if (!canvasName) {
      showToast(
        "Could not determine the canvas name from the page title.",
        "error"
      );
      return;
    }

    if (lastSpan) lastSpan.textContent = "Resolving...";
    btn.disabled = true;

    const requestHeaders = {
      brazeRestApiUrl: settings.brazeRestApiUrl,
      brazeApiKey: settings.brazeApiKey,
      openaiApiKey: settings.openaiApiKey || undefined,
      brazeSourceLocale: settings.brazeSourceLocale || undefined
    };

    const resolvedCanvasId = await requestResolveCanvasId(
      settings.brazeRestApiUrl,
      settings.brazeApiKey,
      canvasName
    );
    if (!resolvedCanvasId.ok || !resolvedCanvasId.canvasId) {
      showToast(
        resolvedCanvasId.message ??
          `Could not find a canvas named "${canvasName}".`,
        "error"
      );
      return;
    }

    if (lastSpan) {
      lastSpan.textContent = "Translating...";
    }
    progressModal = showCanvasTranslateProgressModal();

    const result = await requestCanvasTranslate(
      settings.backendBaseUrl,
      resolvedCanvasId.canvasId,
      requestHeaders
    );

    if (result.ok && result.result) {
      progressModal.close();
      const notification = summarizeCanvasTranslateResult(result.result);
      showToast(notification.message, notification.type);
    } else {
      progressModal.close();
      showToast(
        result.message ?? "Canvas translation failed.",
        "error"
      );
    }
  } catch (error: unknown) {
    progressModal?.close();
    const msg = error instanceof Error ? error.message : "Unknown error";
    showToast(`Error: ${msg}`, "error");
  } finally {
    progressModal?.close();
    if (lastSpan) lastSpan.textContent = originalText;
    btn.disabled = false;
  }
}

function showCanvasTranslateProgressModal(): { readonly close: () => void } {
  const existing = document.getElementById(
    "braze-ai-canvas-translate-progress-backdrop"
  );
  if (existing) {
    existing.remove();
  }

  const backdrop = document.createElement("div");
  backdrop.id = "braze-ai-canvas-translate-progress-backdrop";
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "rgba(26, 26, 46, 0.28)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px"
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    background: "#fff",
    borderRadius: BRAZE_RADIUS_LG,
    border: `1px solid ${BRAZE_BORDER_LIGHT}`,
    padding: "24px",
    width: "min(420px, calc(100vw - 48px))",
    boxShadow: BRAZE_SHADOW_MD,
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    color: BRAZE_TEXT,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: "16px"
  });

  const spinner = document.createElement("div");
  Object.assign(spinner.style, {
    width: "48px",
    height: "48px",
    borderRadius: "999px",
    background:
      "conic-gradient(from 210deg, rgba(128, 29, 215, 0) 0deg, #801dd7 140deg, #FFA524 260deg, rgba(255, 165, 36, 0) 320deg, rgba(128, 29, 215, 0) 360deg)",
    animation: "braze-ai-spin 0.9s linear infinite"
  });
  spinner.setAttribute("aria-hidden", "true");

  const spinnerCenter = document.createElement("div");
  Object.assign(spinnerCenter.style, {
    position: "relative",
    width: "100%",
    height: "100%",
    borderRadius: "999px"
  });

  const spinnerHole = document.createElement("div");
  Object.assign(spinnerHole.style, {
    position: "absolute",
    inset: "5px",
    borderRadius: "999px",
    background: "#fff"
  });
  spinnerCenter.appendChild(spinnerHole);
  spinner.appendChild(spinnerCenter);

  const title = document.createElement("div");
  title.textContent = "Translation in progress...";
  Object.assign(title.style, {
    fontSize: "18px",
    lineHeight: "1.2",
    fontWeight: "700",
    color: BRAZE_TEXT
  });

  const subtitle = document.createElement("div");
  subtitle.textContent =
    "Fetching Braze content, generating translations, and pushing locale updates.";
  Object.assign(subtitle.style, {
    fontSize: "14px",
    lineHeight: "1.5",
    color: BRAZE_MUTED,
    maxWidth: "300px"
  });

  const keyframesStyleId = "braze-ai-spin-keyframes";
  if (!document.getElementById(keyframesStyleId)) {
    const style = document.createElement("style");
    style.id = keyframesStyleId;
    style.textContent =
      "@keyframes braze-ai-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
    document.head.appendChild(style);
  }

  modal.appendChild(spinner);
  modal.appendChild(title);
  modal.appendChild(subtitle);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = (): void => {
    backdrop.remove();
  };

  return { close };
}

async function requestCanvasTranslate(
  backendBaseUrl: string,
  canvasId: string | undefined,
  headers: {
    readonly brazeRestApiUrl: string;
    readonly brazeApiKey: string;
    readonly openaiApiKey?: string;
    readonly brazeSourceLocale?: string;
  },
  canvasName?: string
): Promise<CanvasTranslateResultMessage> {
  if (extensionChrome === undefined) {
    return { ok: false, message: "Chrome extension runtime is unavailable." };
  }

  try {
    return await new Promise<CanvasTranslateResultMessage>((resolve) => {
      extensionChrome.runtime.sendMessage(
        {
          type: TRANSLATE_CANVAS_MESSAGE_TYPE,
          backendBaseUrl,
          canvasId,
          canvasName,
          headers
        },
        (response) => {
          const runtimeError = extensionChrome.runtime.lastError?.message;
          if (runtimeError) {
            resolve({ ok: false, message: runtimeError });
            return;
          }
          if (response === undefined) {
            resolve({
              ok: false,
              message: "Background worker did not respond."
            });
            return;
          }
          resolve(response as CanvasTranslateResultMessage);
        }
      );
    });
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Extension runtime error."
    };
  }
}

async function requestResolveCanvasId(
  brazeRestApiUrl: string,
  brazeApiKey: string,
  canvasName: string
): Promise<ResolveCanvasIdResultMessage> {
  if (extensionChrome === undefined) {
    return { ok: false, message: "Chrome extension runtime is unavailable." };
  }

  try {
    return await new Promise<ResolveCanvasIdResultMessage>((resolve) => {
      extensionChrome.runtime.sendMessage(
        {
          type: RESOLVE_CANVAS_ID_MESSAGE_TYPE,
          brazeRestApiUrl,
          brazeApiKey,
          canvasName
        },
        (response) => {
          const runtimeError = extensionChrome.runtime.lastError?.message;
          if (runtimeError) {
            resolve({ ok: false, message: runtimeError });
            return;
          }
          if (response === undefined) {
            resolve({
              ok: false,
              message: "Background worker did not respond."
            });
            return;
          }
          resolve(response as ResolveCanvasIdResultMessage);
        }
      );
    });
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Extension runtime error."
    };
  }
}

// ---------------------------------------------------------------------------
// Settings Panel / Navigation Entry
// ---------------------------------------------------------------------------

function createTranslateNavIcon(): SVGSVGElement {
  return createToastIcon(
    "M4.545 6.714 4.11 8H3l1.862-5h1.284L8 8H6.833l-.435-1.286zm1.634-.736L5.5 3.956h-.049l-.679 2.022zM0 2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm7.138 9.995q.289.451.63.846c-.748.575-1.673 1.001-2.768 1.292.178.217.451.635.555.867 1.125-.359 2.08-.844 2.886-1.494.777.665 1.739 1.165 2.93 1.472.133-.254.414-.673.629-.89-1.125-.253-2.057-.694-2.82-1.284.681-.747 1.222-1.651 1.621-2.757H14V8h-3v1.047h.765c-.318.844-.74 1.546-1.272 2.13a6 6 0 0 1-.415-.492 2 2 0 0 1-.94.31",
    "0 0 16 16",
    "24",
    "currentColor"
  );
}

function tryInjectTranslationsNavItem(): void {
  const existing = document.getElementById("braze-ai-translations-nav-item");
  if (existing) {
    syncTranslationsNavItemState();
    return;
  }

  const settingsButton = findSettingsNavigationButton();
  const settingsContainer = settingsButton?.closest(
    ".StyledSideNavigationButton__StyledSideNavButtonAndLinkContainer-sc-pdx9m9-2"
  );
  if (!(settingsButton instanceof HTMLButtonElement) || !(settingsContainer instanceof HTMLElement)) {
    return;
  }

  const separator = document.createElement("div");
  separator.id = "braze-ai-translations-nav-separator";
  separator.className =
    "StyledSideNavigationSeparator-sc-918ur1-0 hrykOm bcl-side-navigation-separator";

  const itemContainer = document.createElement("div");
  itemContainer.id = "braze-ai-translations-nav-item";
  itemContainer.className =
    "StyledSideNavigationButton__StyledSideNavButtonAndLinkContainer-sc-pdx9m9-2 fcDNSx";
  itemContainer.dataset.active = "false";

  const activeIndicator = document.createElement("div");
  activeIndicator.className =
    "StyledSideNavigationButton__StyledActiveIndicator-sc-pdx9m9-3 hHsbwI";
  activeIndicator.style.display = "none";

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Translations");
  button.className = settingsButton.className;
  button.style.cursor = "pointer";

  const content = document.createElement("div");
  content.className =
    "StyledSideNavigationButton__StyledSideNavButtonAndLinkContent-sc-pdx9m9-4 bHXeMK";
  content.dataset.active = "false";
  content.dataset.iconOnlyMode = "false";
  content.dataset.isOpen = "false";

  const iconWrapper = document.createElement("div");
  iconWrapper.className =
    "StyledFlex-sc-13lahx9-0 cZzVvX bcl-flex bcl-navigation-icon";
  iconWrapper.style.color = "#8F9BA2";
  const icon = createTranslateNavIcon();
  icon.classList.add("bcl-side-navigation-button-icon");
  iconWrapper.appendChild(icon);

  const text = document.createElement("div");
  text.className =
    "StyledSideNavigationButton__StyledText-sc-pdx9m9-0 hYOXYT bcl-side-navigation-button-text";
  text.textContent = "Translations";

  content.appendChild(iconWrapper);
  content.appendChild(text);
  button.appendChild(content);
  button.addEventListener("click", () => {
    toggleSettingsPanel();
  });

  itemContainer.appendChild(activeIndicator);
  itemContainer.appendChild(button);

  settingsContainer.insertAdjacentElement("afterend", itemContainer);
  itemContainer.insertAdjacentElement("beforebegin", separator);
  syncTranslationsNavItemState();
}

function findSettingsNavigationButton(): HTMLButtonElement | null {
  const navigationBody = document.querySelector(
    ".bcl-side-navigation-body, [class*='side-navigation-body']"
  );
  if (!(navigationBody instanceof HTMLElement)) {
    return null;
  }

  const direct = navigationBody.querySelector(
    "button[aria-label='Settings'][data-route='/settings']"
  );
  if (direct instanceof HTMLButtonElement) {
    return direct;
  }

  for (const button of Array.from(navigationBody.querySelectorAll("button"))) {
    if (!(button instanceof HTMLButtonElement)) {
      continue;
    }
    const label = (button.getAttribute("aria-label") ?? "").trim().toLowerCase();
    const text = normalizeButtonText(button.textContent ?? "");
    if (label === "settings" || text === "settings") {
      return button;
    }
  }

  return null;
}

function syncTranslationsNavItemState(): void {
  const itemContainer = document.getElementById("braze-ai-translations-nav-item");
  if (!(itemContainer instanceof HTMLElement)) {
    return;
  }

  const content = itemContainer.querySelector(
    ".StyledSideNavigationButton__StyledSideNavButtonAndLinkContent-sc-pdx9m9-4"
  );
  const text = itemContainer.querySelector(
    ".bcl-side-navigation-button-text"
  );
  const iconWrapper = itemContainer.querySelector(".bcl-navigation-icon");
  const activeIndicator = itemContainer.querySelector(
    ".StyledSideNavigationButton__StyledActiveIndicator-sc-pdx9m9-3"
  );

  itemContainer.dataset.active = settingsPanelVisible ? "true" : "false";

  if (content instanceof HTMLElement) {
    content.dataset.active = settingsPanelVisible ? "true" : "false";
  }
  if (text instanceof HTMLElement) {
    text.style.color = settingsPanelVisible ? BRAZE_PURPLE : "";
    text.style.fontWeight = settingsPanelVisible ? "700" : "";
  }
  if (iconWrapper instanceof HTMLElement) {
    iconWrapper.style.color = settingsPanelVisible ? BRAZE_PURPLE : "#8F9BA2";
  }
  if (activeIndicator instanceof HTMLElement) {
    activeIndicator.style.display = settingsPanelVisible ? "block" : "none";
  }
}

let settingsPanelVisible = false;
const SETTINGS_BACKDROP_ID = "braze-ai-settings-backdrop";

function closeSettingsPanel(): void {
  document.getElementById("braze-ai-settings-panel")?.remove();
  document.getElementById(SETTINGS_BACKDROP_ID)?.remove();
  settingsPanelVisible = false;
  syncTranslationsNavItemState();
}

function toggleSettingsPanel(): void {
  const existing = document.getElementById("braze-ai-settings-panel");
  if (existing) {
    closeSettingsPanel();
    return;
  }

  settingsPanelVisible = true;
  syncTranslationsNavItemState();
  void renderSettingsPanel();
}

async function renderSettingsPanel(): Promise<void> {
  closeSettingsPanel();

  const settings = await loadStoredSettings();

  const backdrop = document.createElement("div");
  backdrop.id = SETTINGS_BACKDROP_ID;
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483645",
    background: "rgba(26, 26, 46, 0.28)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px"
  });
  backdrop.addEventListener("click", () => {
    closeSettingsPanel();
  });

  const panel = document.createElement("div");
  panel.id = "braze-ai-settings-panel";
  Object.assign(panel.style, {
    position: "relative",
    zIndex: "2147483646",
    width: "420px",
    maxWidth: "min(420px, calc(100vw - 48px))",
    background: "rgba(255,255,255,0.98)",
    border: `1px solid ${BRAZE_BORDER_LIGHT}`,
    borderRadius: BRAZE_RADIUS_LG,
    boxShadow: BRAZE_SHADOW_MD,
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: "13px",
    color: BRAZE_TEXT,
    padding: "24px",
    backdropFilter: "blur(8px)"
  });
  panel.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  const applyFieldStyles = (
    element: HTMLInputElement | HTMLSelectElement
  ): void => {
    Object.assign(element.style, {
      width: "100%",
      height: "48px",
      padding: "0 14px",
      border: `1px solid ${BRAZE_BORDER}`,
      borderRadius: BRAZE_RADIUS_SM,
      fontSize: "14px",
      color: BRAZE_TEXT,
      boxSizing: "border-box",
      background: "#fff",
      outline: "none",
      transition: "border-color 0.15s ease, box-shadow 0.15s ease"
    });
    element.addEventListener("focus", () => {
      element.style.borderColor = BRAZE_PURPLE;
      element.style.boxShadow = "0 0 0 3px rgba(240, 232, 253, 1)";
    });
    element.addEventListener("blur", () => {
      element.style.borderColor = BRAZE_BORDER;
      element.style.boxShadow = "none";
    });
  };

  const createField = (
    labelText: string,
    control: HTMLInputElement | HTMLSelectElement,
    hintText?: string
  ): HTMLElement => {
    const wrapper = document.createElement("label");
    Object.assign(wrapper.style, {
      display: "flex",
      flexDirection: "column",
      gap: "8px"
    });

    const label = document.createElement("div");
    label.textContent = labelText;
    Object.assign(label.style, {
      fontSize: "13px",
      fontWeight: "700",
      color: BRAZE_TEXT
    });
    wrapper.appendChild(label);
    wrapper.appendChild(control);

    if (hintText) {
      const hint = document.createElement("div");
      hint.textContent = hintText;
      Object.assign(hint.style, {
        fontSize: "12px",
        lineHeight: "1.45",
        color: BRAZE_MUTED
      });
      wrapper.appendChild(hint);
    }

    return wrapper;
  };

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    marginBottom: "20px"
  });

  const headerIcon = document.createElement("div");
  Object.assign(headerIcon.style, {
    width: "44px",
    height: "44px",
    borderRadius: BRAZE_RADIUS,
    background: BRAZE_PURPLE_SURFACE,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: BRAZE_PURPLE,
    flexShrink: "0"
  });
  const headerIconImage = createExtensionIconImage(22);
  if (headerIconImage) {
    headerIcon.appendChild(headerIconImage);
  } else {
    headerIcon.appendChild(
      createToastIcon(
        "M487.4 315.7l-42.6-24.6c2.7-13.9 4.2-28.3 4.2-43.1s-1.5-29.2-4.2-43.1l42.6-24.6c15.1-8.7 21.3-27.3 14.7-43.3l-34-81.9c-6.7-16.1-24.4-24.4-41.3-19.5l-47.6 13.6c-20.1-15.6-42.8-28-67.4-36.3L305 12.7C302.2-5 287.2-18 269.2-18h-90.3c-18 0-33 13-35.8 30.7L135.8 62.9c-24.6 8.3-47.3 20.7-67.4 36.3L20.8 85.6C3.9 80.7-13.8 89-20.5 105.1l-34 81.9c-6.6 16-0.4 34.6 14.7 43.3l42.6 24.6c-2.7 13.9-4.2 28.3-4.2 43.1s1.5 29.2 4.2 43.1l-42.6 24.6c-15.1 8.7-21.3 27.3-14.7 43.3l34 81.9c6.7 16.1 24.4 24.4 41.3 19.5l47.6-13.6c20.1 15.6 42.8 28 67.4 36.3l7.3 50.2c2.8 17.7 17.8 30.7 35.8 30.7h90.3c18 0 33-13 35.8-30.7l7.3-50.2c24.6-8.3 47.3-20.7 67.4-36.3l47.6 13.6c16.9 4.9 34.6-3.4 41.3-19.5l34-81.9c6.6-16 .4-34.6-14.7-43.3zM224 352a96 96 0 1 1 0-192 96 96 0 1 1 0 192z",
        "0 0 448 512",
        "18",
        BRAZE_PURPLE
      )
    );
  }

  const headerText = document.createElement("div");
  const headerTitle = document.createElement("div");
  headerTitle.textContent = "Braze AI Translator";
  Object.assign(headerTitle.style, {
    fontSize: "17px",
    fontWeight: "700",
    lineHeight: "1.2",
    color: BRAZE_TEXT,
    letterSpacing: "-0.015em"
  });
  const headerSubtitle = document.createElement("div");
  headerSubtitle.textContent =
    "Configure backend access and canvas translation defaults.";
  Object.assign(headerSubtitle.style, {
    marginTop: "4px",
    fontSize: "13px",
    lineHeight: "1.45",
    color: BRAZE_MUTED
  });
  headerText.appendChild(headerTitle);
  headerText.appendChild(headerSubtitle);
  header.appendChild(headerIcon);
  header.appendChild(headerText);

  const body = document.createElement("div");
  Object.assign(body.style, {
    display: "flex",
    flexDirection: "column",
    gap: "14px"
  });

  const backendInput = document.createElement("input");
  backendInput.dataset.setting = "backendBaseUrl";
  backendInput.type = "text";
  backendInput.value = settings.backendBaseUrl;
  applyFieldStyles(backendInput);

  const endpointSelect = document.createElement("select");
  endpointSelect.dataset.setting = "brazeRestApiUrl";
  applyFieldStyles(endpointSelect);
  BRAZE_REST_ENDPOINTS.forEach((endpoint) => {
    const option = document.createElement("option");
    option.value = endpoint.url;
    option.textContent = endpoint.label;
    option.selected = endpoint.url === settings.brazeRestApiUrl;
    endpointSelect.appendChild(option);
  });

  const brazeKeyInput = document.createElement("input");
  brazeKeyInput.dataset.setting = "brazeApiKey";
  brazeKeyInput.type = "password";
  brazeKeyInput.value = settings.brazeApiKey;
  brazeKeyInput.placeholder = "Braze REST API key";
  applyFieldStyles(brazeKeyInput);

  const openAiKeyInput = document.createElement("input");
  openAiKeyInput.dataset.setting = "openaiApiKey";
  openAiKeyInput.type = "password";
  openAiKeyInput.value = settings.openaiApiKey;
  openAiKeyInput.placeholder = "OpenAI API key (optional)";
  applyFieldStyles(openAiKeyInput);

  const sourceLocaleInput = document.createElement("input");
  sourceLocaleInput.dataset.setting = "brazeSourceLocale";
  sourceLocaleInput.type = "text";
  sourceLocaleInput.value = settings.brazeSourceLocale;
  sourceLocaleInput.placeholder = "e.g. en, en-US, fr-FR";
  applyFieldStyles(sourceLocaleInput);

  body.appendChild(
    createField("Backend URL", backendInput, "Local backend base URL.")
  );
  body.appendChild(createField("Braze REST Endpoint", endpointSelect));
  body.appendChild(createField("Braze API Key", brazeKeyInput));
  body.appendChild(
    createField(
      "OpenAI API Key",
      openAiKeyInput,
      "Optional override for translation runs."
    )
  );
  body.appendChild(
    createField(
      "Source Locale",
      sourceLocaleInput,
      "Used as the source language for canvas translation."
    )
  );

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
    marginTop: "20px"
  });

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.id = "braze-ai-settings-close";
  closeButton.textContent = "Close";
  Object.assign(closeButton.style, {
    height: "40px",
    padding: "0 24px",
    borderRadius: BRAZE_RADIUS_SM,
    border: `1px solid ${BRAZE_PURPLE}`,
    background: "#fff",
    color: BRAZE_PURPLE,
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "600"
  });
  closeButton.addEventListener("mouseenter", () => {
    closeButton.style.background = "#F5F5F8";
  });
  closeButton.addEventListener("mouseleave", () => {
    closeButton.style.background = "#fff";
  });

  const saveButton = document.createElement("button");
  saveButton.id = "braze-ai-settings-save";
  saveButton.type = "button";
  saveButton.textContent = "Save";
  Object.assign(saveButton.style, {
    height: "40px",
    padding: "0 28px",
    borderRadius: BRAZE_RADIUS_SM,
    border: `1px solid ${BRAZE_PURPLE}`,
    background: BRAZE_PURPLE,
    color: "#fff",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "600"
  });
  saveButton.addEventListener("mouseenter", () => {
    saveButton.style.background = BRAZE_PURPLE_HOVER;
    saveButton.style.borderColor = BRAZE_PURPLE_HOVER;
  });
  saveButton.addEventListener("mouseleave", () => {
    saveButton.style.background = BRAZE_PURPLE;
    saveButton.style.borderColor = BRAZE_PURPLE;
  });

  actions.appendChild(closeButton);
  actions.appendChild(saveButton);

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(actions);

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  closeButton.addEventListener("click", () => {
    closeSettingsPanel();
  });

  document
    .getElementById("braze-ai-settings-save")
    ?.addEventListener("click", async () => {
      const getValue = (key: string): string => {
        const el = panel.querySelector(`[data-setting="${key}"]`);
        return el instanceof HTMLInputElement || el instanceof HTMLSelectElement
          ? el.value.trim()
          : "";
      };

      await storeSettings({
        backendBaseUrl: getValue("backendBaseUrl") || DEFAULT_BACKEND_URL,
        brazeRestApiUrl:
          getValue("brazeRestApiUrl") ||
          BRAZE_REST_ENDPOINTS[0]?.url ||
          "",
        brazeApiKey: getValue("brazeApiKey"),
        openaiApiKey: getValue("openaiApiKey"),
        brazeSourceLocale:
          getValue("brazeSourceLocale") || DEFAULT_SOURCE_LOCALE
      });

      closeSettingsPanel();
      showToast("Settings saved.", "success");
    });
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------

const TOAST_CONTAINER_ID = "braze-ai-translator-toast-container";

function ensureToastContainer(): HTMLElement {
  const existing = document.getElementById(TOAST_CONTAINER_ID);
  if (existing instanceof HTMLElement) {
    return existing;
  }

  const container = document.createElement("div");
  container.id = TOAST_CONTAINER_ID;
  container.className =
    "Toastify__toast-container Toastify__toast-container--top-right StyledToaster-sc-1rfesen-0 kjnQAA bcl-toaster";

  Object.assign(container.style, {
    position: "fixed",
    top: "16px",
    right: "16px",
    zIndex: "2147483647",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "min(372px, calc(100vw - 24px))",
    pointerEvents: "none"
  });

  document.body.appendChild(container);
  return container;
}

function getToastTheme(type: ToastType): {
  readonly accentColor: string;
  readonly iconBackground: string;
  readonly iconPath: string;
  readonly iconViewBox: string;
  readonly iconSize: string;
} {
  switch (type) {
    case "success":
      return {
        accentColor: "#00b87c",
        iconBackground: "#d8f5e9",
        iconPath:
          "M434.8 70.1c14.3 10.4 17.5 30.4 7.1 44.7l-256 352c-5.5 7.6-14 12.3-23.4 13.1s-18.5-2.7-25.1-9.3l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l101.5 101.5 234-321.7c10.4-14.3 30.4-17.5 44.7-7.1z",
        iconViewBox: "0 0 448 512",
        iconSize: "20"
      };
    case "error":
      return {
        accentColor: "#df3341",
        iconBackground: "#fde8ea",
        iconPath:
          "M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM160 160c12.5-12.5 32.8-12.5 45.3 0L256 210.7 306.7 160c12.5-12.5 32.8-12.5 45.3 0s12.5 32.8 0 45.3L301.3 256 352 306.7c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L256 301.3 205.3 352c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L210.7 256 160 205.3c-12.5-12.5-12.5-32.8 0-45.3z",
        iconViewBox: "0 0 512 512",
        iconSize: "20"
      };
    case "warning":
      return {
        accentColor: "#ff8a1f",
        iconBackground: "#fff1df",
        iconPath:
          "M256 0c14.7 0 28.2 8.1 35.1 21.1l216 400c6.6 12.2 6.3 26.9-.8 38.9S487.8 480 473.9 480H38.1c-13.9 0-26.8-7.4-33.4-19.5s-6.9-26.8-.8-38.9l216-400C227.8 8.1 241.3 0 256 0zm0 352a40 40 0 1 0 0 80 40 40 0 1 0 0-80zm-24-224 8 160c.7 13.2 11.6 24 24 24s23.3-10.8 24-24l8-160c.8-14.2-10.5-26-24.8-26h-14.4c-14.3 0-25.6 11.8-24.8 26z",
        iconViewBox: "0 0 512 512",
        iconSize: "20"
      };
    case "info":
    default:
      return {
        accentColor: "#2d7ff9",
        iconBackground: "#e5efff",
        iconPath:
          "M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM224 160a32 32 0 1 1 64 0 32 32 0 1 1-64 0zm-8 64 48 0c13.3 0 24 10.7 24 24l0 88 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-80 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l24 0 0-64-24 0c-13.3 0-24-10.7-24-24s10.7-24 24-24z",
        iconViewBox: "0 0 512 512",
        iconSize: "18"
      };
  }
}

function createToastIcon(
  path: string,
  viewBox: string,
  size: string,
  color: string
): SVGSVGElement {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", viewBox);
  icon.setAttribute("width", size);
  icon.setAttribute("height", size);
  icon.setAttribute("aria-hidden", "true");
  icon.style.display = "block";

  const pathElement = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  pathElement.setAttribute("fill", color);
  pathElement.setAttribute("d", path);
  icon.appendChild(pathElement);

  return icon;
}

function createExtensionIconImage(size: number): HTMLImageElement | null {
  const iconUrl = extensionChrome?.runtime.getURL?.("assets/icon-32.png");
  if (!iconUrl) {
    return null;
  }

  const image = document.createElement("img");
  image.src = iconUrl;
  image.alt = "Braze AI Translator";
  image.width = size;
  image.height = size;
  Object.assign(image.style, {
    display: "block",
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "8px"
  });
  return image;
}

function dismissToast(toast: HTMLElement): void {
  toast.style.opacity = "0";
  toast.style.transform = "translateY(-8px) scale(0.98)";
  window.setTimeout(() => {
    toast.remove();
  }, 220);
}

function showToast(
  message: string,
  type: ToastType = "info"
): void {
  const container = ensureToastContainer();
  const theme = getToastTheme(type);
  const toast = document.createElement("div");
  toast.className =
    `Toastify__toast Toastify__toast-theme--light Toastify__toast--${type}`;

  Object.assign(toast.style, {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "min-content 1fr min-content",
    alignItems: "center",
    gap: "14px",
    minHeight: "72px",
    padding: "16px 16px 16px 24px",
    borderRadius: BRAZE_RADIUS,
    background: "#fff",
    border: `1px solid ${theme.accentColor}`,
    boxShadow: BRAZE_SHADOW_MD,
    color: "#1b1d2a",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    pointerEvents: "auto",
    overflow: "hidden",
    opacity: "0",
    transform: "translateY(-8px) scale(0.985)",
    transition: "opacity 0.22s ease, transform 0.22s ease"
  });

  const accentBar = document.createElement("div");
  Object.assign(accentBar.style, {
    position: "absolute",
    top: "0",
    left: "0",
    bottom: "0",
    width: "6px",
    background: theme.accentColor,
    boxShadow: `inset -1px 0 0 ${theme.accentColor}`
  });
  toast.appendChild(accentBar);

  const iconShell = document.createElement("div");
  Object.assign(iconShell.style, {
    width: "40px",
    height: "40px",
    borderRadius: "999px",
    background: theme.iconBackground,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.accentColor,
    flexShrink: "0"
  });
  iconShell.appendChild(
    createToastIcon(
      theme.iconPath,
      theme.iconViewBox,
      theme.iconSize,
      theme.accentColor
    )
  );

  const body = document.createElement("div");
  body.className = "Toastify__toast-body";
  body.setAttribute("role", "alert");
  Object.assign(body.style, {
    display: "flex",
    alignItems: "center",
    minWidth: "0"
  });

  const messageText = document.createElement("div");
  Object.assign(messageText.style, {
    fontSize: "14px",
    lineHeight: "1.35",
    fontWeight: "600",
    color: "#1b1d2a",
    letterSpacing: "-0.01em",
    wordBreak: "break-word"
  });
  messageText.textContent = message;
  body.appendChild(messageText);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className =
    "StyledCloseButton-sc-1ttoa9a-0 KMzPh bcl-close-button";
  closeButton.setAttribute("aria-label", "Close notification");
  Object.assign(closeButton.style, {
    border: "none",
    background: "transparent",
    color: "#7b7f8f",
    width: "24px",
    height: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    cursor: "pointer",
    padding: "0",
    margin: "0",
    transition: "background 0.15s ease, color 0.15s ease"
  });
  closeButton.appendChild(
    createToastIcon(
      "M55.1 73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L147.2 256 9.9 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192.5 301.3 329.9 438.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.8 256 375.1 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192.5 210.7 55.1 73.4z",
      "0 0 384 512",
      "18",
      "currentColor"
    )
  );

  closeButton.addEventListener("mouseenter", () => {
    closeButton.style.background = "#F5F5F8";
    closeButton.style.color = "#4f5565";
  });
  closeButton.addEventListener("mouseleave", () => {
    closeButton.style.background = "transparent";
    closeButton.style.color = "#7b7f8f";
  });
  closeButton.addEventListener("click", () => {
    dismissToast(toast);
  });

  const progressBar = document.createElement("div");
  progressBar.className =
    `Toastify__progress-bar Toastify__progress-bar--animated Toastify__progress-bar-theme--light Toastify__progress-bar--${type}`;
  progressBar.setAttribute("role", "progressbar");
  progressBar.setAttribute("aria-hidden", "true");
  progressBar.setAttribute("aria-label", "notification timer");
  Object.assign(progressBar.style, {
    position: "absolute",
    left: "0",
    right: "0",
    bottom: "0",
    height: "3px",
    opacity: "0",
    background: theme.accentColor
  });

  toast.addEventListener("mouseenter", () => {
    toast.style.background = "#FCFCFE";
  });
  toast.addEventListener("mouseleave", () => {
    toast.style.background = "#fff";
  });

  toast.appendChild(iconShell);
  toast.appendChild(body);
  toast.appendChild(closeButton);
  toast.appendChild(progressBar);

  container.appendChild(toast);

  window.requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0) scale(1)";
  });

  window.setTimeout(() => {
    dismissToast(toast);
  }, 10000);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function bootstrap(): void {
  if (!isBrazePage()) return;

  injectMonacoPageBridge();
  setupTagInsertionTargetTracking();
  setupTagInserterListener();

  if (!isTopLevelFrame()) {
    return;
  }

  tryInjectTranslationsNavItem();
  tryInjectTranslateButton();

  const observer = new MutationObserver(() => {
    tryInjectTranslationsNavItem();
    tryInjectTranslateButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function summarizeCanvasTranslateResult(
  result: CanvasTranslateResponse
): { readonly message: string; readonly type: ToastType } {
  const pushed = result.totalTranslationsPushed;
  const steps = result.stepsProcessed;
  const firstError =
    result.errors[0] ??
    result.stepResults.find((stepResult) => stepResult.errors.length > 0)
      ?.errors[0];

  if (result.resultStatus === "success") {
    return {
      message: `Translation complete: ${pushed} translations pushed across ${steps} step(s).`,
      type: "success"
    };
  }

  if (result.resultStatus === "partial") {
    return {
      message: firstError
        ? `Translation partially complete: ${pushed} translations pushed across ${steps} step(s). First error: ${firstError}`
        : `Translation partially complete: ${pushed} translations pushed across ${steps} step(s).`,
      type: "warning"
    };
  }

  return {
    message: firstError
      ? `Canvas translation failed: ${firstError}`
      : "Canvas translation failed.",
    type: "error"
  };
}

if (document.body) {
  bootstrap();
} else {
  window.addEventListener("DOMContentLoaded", bootstrap, { once: true });
}
