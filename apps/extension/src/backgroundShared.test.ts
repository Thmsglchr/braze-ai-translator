import { describe, expect, it } from "vitest";

import {
  findCanvasIdByName,
  getWrapTranslationContextMenuCreateProperties,
  normalizeCanvasName,
  shouldRetryWrapTranslationMessage
} from "./backgroundShared.js";

describe("backgroundShared", () => {
  it("creates a context menu config that can run inside iframe-backed editors", () => {
    expect(getWrapTranslationContextMenuCreateProperties()).toEqual({
      id: "braze-wrap-translation-tag",
      title: "Wrap in translation tag",
      contexts: ["selection", "editable"]
    });
  });

  it("retries when frame-targeted delivery fails or no listener responds", () => {
    expect(
      shouldRetryWrapTranslationMessage(
        "Could not establish connection. Receiving end does not exist.",
        undefined
      )
    ).toBe(true);
    expect(shouldRetryWrapTranslationMessage(undefined, undefined)).toBe(true);
    expect(shouldRetryWrapTranslationMessage(undefined, { ok: true })).toBe(
      false
    );
  });

  it("normalizes canvas names before matching", () => {
    expect(normalizeCanvasName("  Wyylde   -  Translations  ")).toBe(
      "wyylde - translations"
    );
  });

  it("finds the real Braze canvas UUID by title name", () => {
    expect(
      findCanvasIdByName(
        [
          {
            id: "4af78996-57ac-4ff2-8e0f-0b597a55d46f",
            name: "Wyylde - Translations"
          },
          {
            id: "other-id",
            name: "Another canvas"
          }
        ],
        "  Wyylde -   Translations "
      )
    ).toBe("4af78996-57ac-4ff2-8e0f-0b597a55d46f");
  });
});
