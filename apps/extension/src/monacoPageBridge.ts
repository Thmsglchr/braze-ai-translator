/**
 * Monaco Page Bridge
 *
 * Injected into the MAIN world of Braze pages so it can access
 * window.monaco and the editor instances directly.  Communicates
 * with the content-script (isolated world) via CustomEvents on
 * `window`.
 *
 * Protocol (all detail payloads are JSON strings):
 *
 *  content-script  →  bridge:
 *    "braze-ai-monaco-get-selection"     (no detail)
 *    "braze-ai-monaco-replace-selection"  { replacement: string }
 *
 *  bridge  →  content-script:
 *    "braze-ai-monaco-selection-result"   { ok, selectedText?, fullText?, hasSelection? }
 *    "braze-ai-monaco-replace-result"     { ok, error? }
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface MonacoModelLike {
  getValue(): string;
  getValueInRange(range: unknown): string;
}

interface MonacoSelectionLike {
  isEmpty(): boolean;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface MonacoEditorLike {
  getModel(): MonacoModelLike | null;
  getSelection(): MonacoSelectionLike | null;
  hasTextFocus(): boolean;
  executeEdits(
    source: string,
    edits: {
      range: unknown;
      text: string;
      forceMoveMarkers?: boolean;
    }[]
  ): boolean;
  focus(): void;
}

interface MonacoApiLike {
  editor: {
    getEditors(): MonacoEditorLike[];
  };
  Range: new (
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ) => unknown;
}

(function brazeAiMonacoBridge(): void {
  const GET_SELECTION_EVENT = "braze-ai-monaco-get-selection";
  const SELECTION_RESULT_EVENT = "braze-ai-monaco-selection-result";
  const REPLACE_SELECTION_EVENT = "braze-ai-monaco-replace-selection";
  const REPLACE_RESULT_EVENT = "braze-ai-monaco-replace-result";
  const READY_EVENT = "braze-ai-monaco-bridge-ready";

  let cachedMonacoApi: MonacoApiLike | null = null;

  function getMonacoApi(): MonacoApiLike | null {
    if (cachedMonacoApi !== null) {
      return cachedMonacoApi;
    }

    const w = globalThis as typeof globalThis & {
      monaco?: MonacoApiLike;
      [key: string]: unknown;
    };

    if (looksLikeMonacoApi(w.monaco)) {
      cachedMonacoApi = w.monaco as MonacoApiLike;
      return cachedMonacoApi;
    }

    // Scan common alternative global names
    const candidateNames = [
      "monaco",
      "Monaco",
      "_monaco",
      "__monaco",
      "monacoEditor",
      "MonacoEditor"
    ];
    for (const name of candidateNames) {
      try {
        const candidate = w[name];
        if (looksLikeMonacoApi(candidate)) {
          cachedMonacoApi = candidate as MonacoApiLike;
          return cachedMonacoApi;
        }
      } catch {
        /* skip */
      }
    }

    // Webpack module cache interception -- Monaco is bundled by webpack
    // and not exposed on window, so we extract it from the module cache.
    const webpackResult = findMonacoViaWebpack();
    if (webpackResult !== null) {
      cachedMonacoApi = webpackResult;
      return cachedMonacoApi;
    }

    // AMD require fallback
    const r = globalThis as typeof globalThis & {
      require?: (
        deps: string[],
        cb: (m: MonacoApiLike) => void
      ) => void;
    };
    if (typeof r.require === "function") {
      let found: MonacoApiLike | null = null;
      try {
        r.require(["vs/editor/editor.main"], (m: MonacoApiLike) => {
          if (looksLikeMonacoApi(m)) {
            found = m;
          }
        });
      } catch {
        /* AMD require unavailable */
      }
      if (found !== null) {
        cachedMonacoApi = found;
        return cachedMonacoApi;
      }
    }

    return null;
  }

  function findMonacoViaWebpack(): MonacoApiLike | null {
    const w = globalThis as typeof globalThis & { [key: string]: unknown };

    // Find webpack chunk arrays (webpack 4: webpackJsonp, webpack 5: webpackChunk*)
    const chunkKeys: string[] = [];
    try {
      for (const key of Object.getOwnPropertyNames(w)) {
        if (
          key.startsWith("webpackChunk") ||
          key === "webpackJsonp"
        ) {
          try {
            const value = w[key];
            if (Array.isArray(value)) {
              chunkKeys.push(key);
            }
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      /* skip */
    }

    for (const key of chunkKeys) {
      const result = extractMonacoFromChunkArray(
        w[key] as unknown[]
      );
      if (result !== null) return result;
    }

    return null;
  }

  interface WebpackRequireLike {
    (id: string | number): Record<string, unknown>;
    c?: Record<string, { exports?: unknown }>;
    m?: Record<string, unknown>;
  }

  function extractMonacoFromChunkArray(
    chunks: unknown[]
  ): MonacoApiLike | null {
    let captured: WebpackRequireLike | null = null;

    try {
      const fakeId = `braze_ai_${Date.now()}`;
      (chunks as { push(v: unknown): void }).push([
        [fakeId],
        {},
        (req: WebpackRequireLike) => {
          captured = req;
        }
      ]);
    } catch {
      return null;
    }

    // captured is assigned synchronously inside the push callback but
    // TypeScript can't prove that, so we cast through unknown.
    const webpackRequire = captured as unknown as WebpackRequireLike | null;
    if (webpackRequire === null) {
      return null;
    }
    const moduleCache = webpackRequire.c;
    if (moduleCache === undefined) {
      return null;
    }

    for (const moduleId of Object.keys(moduleCache)) {
      try {
        const mod = moduleCache[moduleId];
        if (mod?.exports === undefined || mod.exports === null) {
          continue;
        }

        // Check if the module's default export is Monaco
        if (looksLikeMonacoApi(mod.exports)) {
          return mod.exports as unknown as MonacoApiLike;
        }

        // Check named exports
        const exports = mod.exports as Record<string, unknown>;
        if (typeof exports !== "object") continue;

        for (const exportKey of Object.keys(exports)) {
          try {
            if (looksLikeMonacoApi(exports[exportKey])) {
              return exports[exportKey] as unknown as MonacoApiLike;
            }
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip inaccessible modules */
      }
    }

    return null;
  }

  function looksLikeMonacoApi(value: unknown): boolean {
    if (value === null || value === undefined || typeof value !== "object") {
      return false;
    }
    try {
      const v = value as Record<string, unknown>;
      const editor = v.editor;
      return (
        editor !== null &&
        editor !== undefined &&
        typeof editor === "object" &&
        typeof (editor as Record<string, unknown>).getEditors === "function"
      );
    } catch {
      return false;
    }
  }

  function findEditors(): MonacoEditorLike[] {
    const api = getMonacoApi();
    if (api !== null) {
      try {
        const editors = api.editor.getEditors();
        if (editors.length > 0) return editors;
      } catch {
        /* getEditors might throw */
      }
    }

    // Fallback: find editors via React fiber tree on Monaco containers
    const results: MonacoEditorLike[] = [];
    const containers = document.querySelectorAll(".monaco-editor");
    for (let i = 0; i < containers.length; i += 1) {
      const el = containers[i] as HTMLElement & Record<string, unknown>;

      // Try direct properties on the DOM element
      const editor = scanObjectForEditor(el, 1);
      if (editor !== null) {
        results.push(editor);
        continue;
      }

      // Walk React fiber tree (comprehensive search)
      const fiberEditor = findEditorViaReactFiber(el);
      if (fiberEditor !== null) {
        results.push(fiberEditor);
      }
    }

    return results;
  }

  function findEditorViaReactFiber(
    element: HTMLElement
  ): MonacoEditorLike | null {
    // Walk UP the DOM to find the nearest React-rendered ancestor, since
    // Monaco creates .monaco-editor elements itself (no React fiber on them).
    let current: HTMLElement | null = element;
    let domDepth = 0;
    while (current !== null && domDepth < 15) {
      const keys = Object.getOwnPropertyNames(current);
      const fiberKey = keys.find(
        (k) =>
          k.startsWith("__reactFiber$") ||
          k.startsWith("__reactInternalInstance$") ||
          k.startsWith("__reactContainer$")
      );
      if (fiberKey !== undefined) {
        const editor = walkFiberForEditor(
          (current as HTMLElement & Record<string, unknown>)[
            fiberKey
          ] as Record<string, unknown> | null
        );
        if (editor !== null) return editor;
      }
      current = current.parentElement;
      domDepth += 1;
    }
    return null;
  }

  function walkFiberForEditor(
    fiber: Record<string, unknown> | null
  ): MonacoEditorLike | null {
    let current = fiber;
    let depth = 0;
    while (current !== null && depth < 50) {
      depth += 1;

      // Check standard React fiber properties
      for (const prop of ["memoizedProps", "stateNode", "memoizedState"]) {
        const found = scanForEditorInFiberProp(current[prop]);
        if (found !== null) return found;
      }

      // Also check pendingProps and ref (ref callback might hold editor)
      for (const prop of ["pendingProps", "ref"]) {
        const found = scanForEditorInFiberProp(current[prop]);
        if (found !== null) return found;
      }

      current = current.return as Record<string, unknown> | null;
    }
    return null;
  }

  function scanForEditorInFiberProp(
    value: unknown
  ): MonacoEditorLike | null {
    if (value === null || value === undefined || typeof value !== "object") {
      return null;
    }

    if (isEditorLike(value)) {
      return value as unknown as MonacoEditorLike;
    }

    // Scan all own properties (handles any prop name like `editorRef`, `_editor`, etc.)
    const obj = value as Record<string, unknown>;
    try {
      for (const key of Object.getOwnPropertyNames(obj)) {
        try {
          const child = obj[key];
          if (isEditorLike(child)) {
            return child as unknown as MonacoEditorLike;
          }

          // One more level: check .current (React refs)
          if (
            child !== null &&
            child !== undefined &&
            typeof child === "object"
          ) {
            const refCurrent = (child as Record<string, unknown>).current;
            if (isEditorLike(refCurrent)) {
              return refCurrent as unknown as MonacoEditorLike;
            }
          }
        } catch {
          /* skip inaccessible properties */
        }
      }
    } catch {
      /* skip */
    }

    return null;
  }

  function isEditorLike(value: unknown): boolean {
    if (value === null || value === undefined || typeof value !== "object") {
      return false;
    }
    const v = value as Record<string, unknown>;
    return (
      typeof v.getModel === "function" &&
      typeof v.getSelection === "function" &&
      typeof v.executeEdits === "function"
    );
  }

  function scanObjectForEditor(
    obj: Record<string, unknown>,
    maxDepth: number
  ): MonacoEditorLike | null {
    if (maxDepth <= 0) return null;
    try {
      for (const key of Object.getOwnPropertyNames(obj)) {
        try {
          const value = obj[key];
          if (isEditorLike(value)) {
            return value as unknown as MonacoEditorLike;
          }
          if (
            maxDepth > 1 &&
            value !== null &&
            value !== undefined &&
            typeof value === "object" &&
            value !== obj
          ) {
            const inner = scanObjectForEditor(
              value as Record<string, unknown>,
              maxDepth - 1
            );
            if (inner !== null) return inner;
          }
        } catch {
          /* skip inaccessible properties */
        }
      }
    } catch {
      /* skip */
    }
    return null;
  }

  function findFocusedEditor(): MonacoEditorLike | null {
    const editors = findEditors();

    for (const editor of editors) {
      try {
        if (editor.hasTextFocus()) return editor;
      } catch {
        /* skip */
      }
    }

    for (const editor of editors) {
      try {
        const sel = editor.getSelection();
        if (sel !== null && !sel.isEmpty()) return editor;
      } catch {
        /* skip */
      }
    }

    return editors[0] ?? null;
  }

  function makeRange(
    sel: MonacoSelectionLike
  ): unknown {
    const api = getMonacoApi();
    if (api !== null) {
      return new api.Range(
        sel.startLineNumber,
        sel.startColumn,
        sel.endLineNumber,
        sel.endColumn
      );
    }

    return {
      startLineNumber: sel.startLineNumber,
      startColumn: sel.startColumn,
      endLineNumber: sel.endLineNumber,
      endColumn: sel.endColumn
    };
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  window.addEventListener(GET_SELECTION_EVENT, () => {
    try {
      const editor = findFocusedEditor();
      if (editor === null) {
        const apiExists = getMonacoApi() !== null;
        const domCount = document.querySelectorAll(".monaco-editor").length;
        respond(SELECTION_RESULT_EVENT, {
          ok: false,
          error: `No Monaco editor found (api=${String(apiExists)}, dom=${String(domCount)})`
        });
        return;
      }

      const selection = editor.getSelection();
      const model = editor.getModel();
      const hasSelection =
        selection !== null && !selection.isEmpty();
      const selectedText =
        hasSelection && model !== null
          ? model.getValueInRange(selection)
          : "";
      const fullText = model?.getValue() ?? "";

      respond(SELECTION_RESULT_EVENT, {
        ok: true,
        selectedText,
        fullText,
        hasSelection
      });
    } catch (err: unknown) {
      respond(SELECTION_RESULT_EVENT, {
        ok: false,
        error: String(err)
      });
    }
  });

  window.addEventListener(REPLACE_SELECTION_EVENT, (event: Event) => {
    try {
      const detail = JSON.parse(
        (event as CustomEvent<string>).detail as string
      ) as { replacement: string };

      const editor = findFocusedEditor();
      if (editor === null) {
        respond(REPLACE_RESULT_EVENT, {
          ok: false,
          error: "No Monaco editor found"
        });
        return;
      }

      const selection = editor.getSelection();
      if (selection === null || selection.isEmpty()) {
        respond(REPLACE_RESULT_EVENT, {
          ok: false,
          error: "No text selected in Monaco"
        });
        return;
      }

      const range = makeRange(selection);
      editor.executeEdits("braze-ai-translator", [
        { range, text: detail.replacement, forceMoveMarkers: true }
      ]);

      respond(REPLACE_RESULT_EVENT, { ok: true });
    } catch (err: unknown) {
      respond(REPLACE_RESULT_EVENT, {
        ok: false,
        error: String(err)
      });
    }
  });

  function respond(eventName: string, payload: Record<string, unknown>): void {
    window.dispatchEvent(
      new CustomEvent(eventName, { detail: JSON.stringify(payload) })
    );
  }

  // Diagnostic function callable from DevTools console:
  //   __brazeAiMonacoDiag()
  (globalThis as typeof globalThis & {
    __brazeAiMonacoDiag?: () => Record<string, unknown>;
  }).__brazeAiMonacoDiag = function (): Record<string, unknown> {
    const api = getMonacoApi();
    const editors = findEditors();
    const focused = findFocusedEditor();
    const domCount = document.querySelectorAll(".monaco-editor").length;

    const editorDetails = editors.map((ed, i) => {
      try {
        const sel = ed.getSelection();
        return {
          index: i,
          hasFocus: ed.hasTextFocus(),
          selection: sel
            ? {
                empty: sel.isEmpty(),
                start: `${String(sel.startLineNumber)}:${String(sel.startColumn)}`,
                end: `${String(sel.endLineNumber)}:${String(sel.endColumn)}`
              }
            : null,
          modelValue: ed.getModel()?.getValue()?.slice(0, 120) ?? null
        };
      } catch (err: unknown) {
        return { index: i, error: String(err) };
      }
    });

    // Check for webpack chunk arrays
    const w = globalThis as typeof globalThis & { [k: string]: unknown };
    const webpackChunkKeys: string[] = [];
    try {
      for (const key of Object.getOwnPropertyNames(w)) {
        if (key.startsWith("webpackChunk") || key === "webpackJsonp") {
          try {
            if (Array.isArray(w[key])) {
              webpackChunkKeys.push(key);
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }

    // Check for React fibers on ancestor elements of first .monaco-editor
    let reactFiberFound = false;
    const firstMonaco = document.querySelector(".monaco-editor");
    if (firstMonaco instanceof HTMLElement) {
      let el: HTMLElement | null = firstMonaco;
      let d = 0;
      while (el !== null && d < 15) {
        const elKeys = Object.getOwnPropertyNames(el);
        if (elKeys.some((k) =>
          k.startsWith("__reactFiber$") ||
          k.startsWith("__reactInternalInstance$") ||
          k.startsWith("__reactContainer$")
        )) {
          reactFiberFound = true;
          break;
        }
        el = el.parentElement;
        d += 1;
      }
    }

    return {
      bridgeLoaded: true,
      monacoApiFound: api !== null,
      editorsFound: editors.length,
      focusedEditor: focused !== null,
      domMonacoElements: domCount,
      editors: editorDetails,
      windowMonacoType: typeof (globalThis as Record<string, unknown>).monaco,
      webpackChunkKeys,
      reactFiberFoundNearMonaco: reactFiberFound
    };
  };

  window.dispatchEvent(new CustomEvent(READY_EVENT));
})();
