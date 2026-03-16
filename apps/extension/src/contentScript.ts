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
const WRAP_TRANSLATION_TAG_MESSAGE_TYPE =
  "braze-ai-translator/wrap-translation-tag";

interface CanvasTranslateResultMessage {
  readonly ok: boolean;
  readonly result?: CanvasTranslateResponse;
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
      readonly kind: "contenteditable";
      readonly editableElement: HTMLElement;
      readonly range: Range;
      readonly selectedText: string;
    };

type ToastType = "success" | "error" | "info" | "warning";

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
  readonly runtime: ChromeRuntimeLike;
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

function parseCanvasIdFromUrl(): string | null {
  const match = window.location.pathname.match(
    /\/canvas\/([0-9a-f-]{36})/i
  );
  return match?.[1] ?? null;
}

function isBrazePage(): boolean {
  const host = window.location.hostname;
  return (
    host.endsWith(".braze.com") ||
    host.endsWith(".appboy.com") ||
    host.endsWith(".braze.eu")
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ---------------------------------------------------------------------------
// Tool 1: Translation Tag Inserter
// ---------------------------------------------------------------------------

function setupTagInserterListener(): void {
  extensionChrome?.runtime.onMessage?.addListener(
    (message: unknown, _sender: unknown, _sendResponse: unknown) => {
      if (!isRecord(message)) return;
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

      showTagIdModal(selectionText);
    }
  );
}

function setupTagInsertionTargetTracking(): void {
  document.addEventListener(
    "contextmenu",
    () => {
      pendingTagInsertionTarget = captureTagInsertionTarget();
    },
    true
  );
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
    background: "rgba(0,0,0,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    background: "#fff",
    borderRadius: "8px",
    padding: "20px",
    minWidth: "320px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "14px",
    color: "#111"
  });

  const preview = selectedText.length > 60
    ? selectedText.slice(0, 57) + "..."
    : selectedText;

  modal.innerHTML = `
    <div style="font-weight:600;font-size:15px;margin-bottom:12px">Wrap in translation tag</div>
    <div style="margin-bottom:8px;color:#555;font-size:12px">Selected: <em>${escapeHtml(preview || "(no text)")}</em></div>
    <label style="display:block;margin-bottom:4px;font-weight:500">Translation ID</label>
    <input id="braze-ai-tag-id-input" type="text" placeholder="e.g. headline, cta_button" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box" />
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button id="braze-ai-tag-cancel" style="padding:6px 16px;border:1px solid #ccc;border-radius:4px;background:#f5f5f5;cursor:pointer;font-size:13px">Cancel</button>
      <button id="braze-ai-tag-confirm" style="padding:6px 16px;border:none;border-radius:4px;background:#2d7ff9;color:#fff;cursor:pointer;font-size:13px;font-weight:500">Insert Tag</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const input = document.getElementById(
    "braze-ai-tag-id-input"
  ) as HTMLInputElement;
  input?.focus();

  const close = (): void => {
    pendingTagInsertionTarget = null;
    backdrop.remove();
  };

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  document.getElementById("braze-ai-tag-cancel")?.addEventListener(
    "click",
    close
  );

  document
    .getElementById("braze-ai-tag-confirm")
    ?.addEventListener("click", () => {
      const tagId = input?.value.trim();
      if (!tagId) {
        input.style.borderColor = "#e53e3e";
        return;
      }

      insertTranslationTag(tagId, selectedText);
      close();
    });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const tagId = input.value.trim();
      if (!tagId) {
        input.style.borderColor = "#e53e3e";
        return;
      }
      insertTranslationTag(tagId, selectedText);
      close();
    }
    if (e.key === "Escape") close();
  });
}

function insertTranslationTag(tagId: string, selectedText: string): void {
  const savedTarget = pendingTagInsertionTarget;
  pendingTagInsertionTarget = null;

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
    const inserted =
      savedTarget.kind === "form_control"
        ? writeTranslationTagToFormControl(savedTarget, tagged)
        : writeTranslationTagToEditableRange(savedTarget, tagged);

    if (inserted) {
      return;
    }
  }

  const fallbackTarget = captureTagInsertionTarget();
  if (fallbackTarget !== null) {
    const inserted =
      fallbackTarget.kind === "form_control"
        ? writeTranslationTagToFormControl(fallbackTarget, tagged)
        : writeTranslationTagToEditableRange(fallbackTarget, tagged);

    if (inserted) {
      return;
    }
  }

  showToast(
    "Could not restore the original Braze editor selection. Re-select the text and try again.",
    "error"
  );
}

function buildTranslationTag(tagId: string, selectedText: string): string {
  return `{% translation ${tagId} %}${selectedText}{% endtranslation %}`;
}

function captureTagInsertionTarget(): TagInsertionTarget | null {
  const activeElement = document.activeElement;

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

  const selection = window.getSelection();

  if (
    selection === null ||
    selection.rangeCount === 0 ||
    selection.isCollapsed
  ) {
    return null;
  }

  const selectedText = selection.toString();
  if (selectedText.length === 0) {
    return null;
  }

  const range = selection.getRangeAt(0).cloneRange();
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

function writeTranslationTagToFormControl(
  target: Extract<TagInsertionTarget, { readonly kind: "form_control" }>,
  tagged: string
): boolean {
  try {
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
    return true;
  } catch {
    return false;
  }
}

function writeTranslationTagToEditableRange(
  target: Extract<TagInsertionTarget, { readonly kind: "contenteditable" }>,
  tagged: string
): boolean {
  const selection = window.getSelection();

  if (selection === null) {
    return false;
  }

  try {
    target.editableElement.focus();
    selection.removeAllRanges();
    selection.addRange(target.range);

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(tagged);
    range.insertNode(textNode);

    const collapsedRange = document.createRange();
    collapsedRange.setStartAfter(textNode);
    collapsedRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(collapsedRange);

    dispatchEditorChangeEvents(target.editableElement);
    return true;
  } catch {
    return false;
  }
}

function dispatchEditorChangeEvents(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLElement
): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Tool 2: Canvas Translate Button
// ---------------------------------------------------------------------------

let translateButtonInjected = false;

function tryInjectTranslateButton(): void {
  if (translateButtonInjected) return;

  const canvasId = parseCanvasIdFromUrl();
  if (!canvasId) return;

  const testButton = document.querySelector(
    "button.canvas-btn-test-canvas"
  );
  if (!testButton) return;

  const wrapper = document.createElement("div");
  wrapper.className = "StyledButtonWrapper-sc-193l6tp-0 hpQzVB bcl-button__disabled-wrapper";

  const btn = document.createElement("button");
  btn.setAttribute("data-is-loading", "false");
  btn.setAttribute("data-loading-state", "idle");
  btn.className = testButton.className;
  btn.type = "button";
  btn.innerHTML = `<span class="${getButtonContentClass(testButton)}"><span class="${getButtonIconClass(testButton)}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" width="18" height="18" fill="currentColor"><path d="M0 128C0 92.7 28.7 64 64 64l192 0 48 0 16 0 256 0c35.3 0 64 28.7 64 64l0 256c0 35.3-28.7 64-64 64l-256 0-16 0-48 0L64 448c-35.3 0-64-28.7-64-64L0 128zm320 0l0 256 256 0 0-256-256 0zM178.3 175.9c-3.2-7.2-10.4-11.9-18.3-11.9s-15.1 4.7-18.3 11.9l-64 144c-4.5 10.1 .1 21.9 10.2 26.4s21.9-.1 26.4-10.2l8.9-20.1 73.6 0 8.9 20.1c4.5 10.1 16.3 14.6 26.4 10.2s14.6-16.3 10.2-26.4l-64-144zM160 233.2L179 276l-38 0 19-42.8zM448 164c11 0 20 9 20 20l0 4 44 0c11 0 20 9 20 20s-9 20-20 20l-2 0-1.6 4.5c-8.9 24.4-22.8 46.7-41.2 65.7l-1 1.1 9.9 9.9c7.8 7.8 7.8 20.5 0 28.3s-20.5 7.8-28.3 0l-13.1-13.1c-4.3 3.2-8.8 6.2-13.4 8.9l-.2 .1c-9.6 5.5-21.8 2.2-27.3-7.4s-2.2-21.8 7.4-27.3l.2-.1c2.4-1.4 4.7-2.9 6.9-4.5l-8.2-8.2c-7.8-7.8-7.8-20.5 0-28.3s20.5-7.8 28.3 0l6.3 6.3c7.4-10.4 13.2-22 17.1-34.4l-65.5 0c-11 0-20-9-20-20s9-20 20-20l44 0 0-4c0-11 9-20 20-20z"/></svg></span><span>Translate Canvas</span></span>`;

  btn.addEventListener("click", () => {
    void handleTranslateCanvasClick(canvasId, btn);
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

  translateButtonInjected = true;
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
  canvasId: string,
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
  if (lastSpan) lastSpan.textContent = "Translating...";
  btn.disabled = true;

  try {
    const result = await requestCanvasTranslate(
      settings.backendBaseUrl,
      canvasId,
      {
        brazeRestApiUrl: settings.brazeRestApiUrl,
        brazeApiKey: settings.brazeApiKey,
        openaiApiKey: settings.openaiApiKey || undefined,
        brazeSourceLocale: settings.brazeSourceLocale || undefined
      }
    );

    if (result.ok && result.result) {
      const notification = summarizeCanvasTranslateResult(result.result);
      showToast(notification.message, notification.type);
    } else {
      showToast(
        result.message ?? "Canvas translation failed.",
        "error"
      );
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    showToast(`Error: ${msg}`, "error");
  } finally {
    if (lastSpan) lastSpan.textContent = originalText;
    btn.disabled = false;
  }
}

async function requestCanvasTranslate(
  backendBaseUrl: string,
  canvasId: string,
  headers: {
    readonly brazeRestApiUrl: string;
    readonly brazeApiKey: string;
    readonly openaiApiKey?: string;
    readonly brazeSourceLocale?: string;
  }
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

// ---------------------------------------------------------------------------
// Settings Panel (small gear icon in bottom-left)
// ---------------------------------------------------------------------------

function injectSettingsGear(): void {
  if (document.getElementById("braze-ai-settings-gear")) return;

  const gear = document.createElement("div");
  gear.id = "braze-ai-settings-gear";
  Object.assign(gear.style, {
    position: "fixed",
    bottom: "12px",
    left: "12px",
    zIndex: "2147483646",
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    background: "#2d7ff9",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    fontSize: "18px",
    fontFamily: "system-ui, sans-serif",
    userSelect: "none"
  });
  gear.textContent = "\u2699";
  gear.title = "Braze AI Translator Settings";

  gear.addEventListener("click", () => {
    toggleSettingsPanel();
  });

  document.body.appendChild(gear);
}

let settingsPanelVisible = false;

function toggleSettingsPanel(): void {
  const existing = document.getElementById("braze-ai-settings-panel");
  if (existing) {
    existing.remove();
    settingsPanelVisible = false;
    return;
  }

  settingsPanelVisible = true;
  void renderSettingsPanel();
}

async function renderSettingsPanel(): Promise<void> {
  const existing = document.getElementById("braze-ai-settings-panel");
  if (existing) existing.remove();

  const settings = await loadStoredSettings();

  const panel = document.createElement("div");
  panel.id = "braze-ai-settings-panel";
  Object.assign(panel.style, {
    position: "fixed",
    bottom: "56px",
    left: "12px",
    zIndex: "2147483646",
    width: "340px",
    background: "#fff",
    border: "1px solid #ddd",
    borderRadius: "8px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "13px",
    color: "#111",
    padding: "16px"
  });

  panel.innerHTML = `
    <div style="font-weight:600;font-size:14px;margin-bottom:12px">Braze AI Translator Settings</div>
    <label style="display:block;margin-bottom:4px;font-weight:500;font-size:12px">Backend URL</label>
    <input data-setting="backendBaseUrl" type="text" value="${escapeHtml(settings.backendBaseUrl)}" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;margin-bottom:10px;box-sizing:border-box" />
    <label style="display:block;margin-bottom:4px;font-weight:500;font-size:12px">Braze REST Endpoint</label>
    <select data-setting="brazeRestApiUrl" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;margin-bottom:10px;box-sizing:border-box">
      ${BRAZE_REST_ENDPOINTS.map(
        (ep) =>
          `<option value="${escapeHtml(ep.url)}"${ep.url === settings.brazeRestApiUrl ? " selected" : ""}>${escapeHtml(ep.label)}</option>`
      ).join("")}
    </select>
    <label style="display:block;margin-bottom:4px;font-weight:500;font-size:12px">Braze API Key</label>
    <input data-setting="brazeApiKey" type="password" value="${escapeHtml(settings.brazeApiKey)}" placeholder="Braze REST API key" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;margin-bottom:10px;box-sizing:border-box" />
	    <label style="display:block;margin-bottom:4px;font-weight:500;font-size:12px">OpenAI API Key</label>
	    <input data-setting="openaiApiKey" type="password" value="${escapeHtml(settings.openaiApiKey)}" placeholder="OpenAI API key (optional)" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;margin-bottom:10px;box-sizing:border-box" />
	    <label style="display:block;margin-bottom:4px;font-weight:500;font-size:12px">Source Locale</label>
	    <input data-setting="brazeSourceLocale" type="text" value="${escapeHtml(settings.brazeSourceLocale)}" placeholder="e.g. en, en-US, fr-FR" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;margin-bottom:10px;box-sizing:border-box" />
	    <div style="text-align:right;margin-top:4px">
	      <button id="braze-ai-settings-save" style="padding:6px 16px;border:none;border-radius:4px;background:#2d7ff9;color:#fff;cursor:pointer;font-size:12px;font-weight:500">Save</button>
	    </div>
  `;

  document.body.appendChild(panel);

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

      showToast("Settings saved.", "success");
      panel.remove();
      settingsPanelVisible = false;
    });
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------

function showToast(
  message: string,
  type: ToastType = "info"
): void {
  const toast = document.createElement("div");
  const bgColor =
    type === "success"
      ? "#38a169"
      : type === "error"
        ? "#e53e3e"
        : type === "warning"
          ? "#dd6b20"
        : "#2d7ff9";

  Object.assign(toast.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    zIndex: "2147483647",
    background: bgColor,
    color: "#fff",
    padding: "12px 20px",
    borderRadius: "8px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "13px",
    maxWidth: "420px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
    transition: "opacity 0.3s",
    cursor: "pointer"
  });
  toast.textContent = message;

  toast.addEventListener("click", () => toast.remove());
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function bootstrap(): void {
  if (!isBrazePage()) return;

  setupTagInsertionTargetTracking();
  setupTagInserterListener();
  injectSettingsGear();

  tryInjectTranslateButton();

  const observer = new MutationObserver(() => {
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
