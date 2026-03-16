import { describe, expect, it } from "vitest";

import {
  getWrapTranslationContextMenuCreateProperties,
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
});
