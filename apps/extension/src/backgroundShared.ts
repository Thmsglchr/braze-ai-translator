export type WrapTranslationContextMenuCreateProperties = Record<
  string,
  unknown
> & {
  readonly id: "braze-wrap-translation-tag";
  readonly title: "Wrap in translation tag";
  readonly contexts: readonly ("selection" | "editable")[];
};

export function getWrapTranslationContextMenuCreateProperties(): WrapTranslationContextMenuCreateProperties {
  return {
    id: "braze-wrap-translation-tag",
    title: "Wrap in translation tag",
    contexts: ["selection", "editable"]
  };
}

export function shouldRetryWrapTranslationMessage(
  lastErrorMessage: string | undefined,
  response: unknown
): boolean {
  if (typeof lastErrorMessage === "string" && lastErrorMessage.length > 0) {
    return true;
  }

  return response === undefined;
}

export interface BrazeCanvasListItem {
  readonly id: string;
  readonly name: string;
  readonly tags?: readonly string[];
  readonly last_edited?: string;
}

export function normalizeCanvasName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findCanvasIdByName(
  canvases: readonly BrazeCanvasListItem[],
  canvasName: string
): string | null {
  const normalizedCanvasName = normalizeCanvasName(canvasName);

  for (const canvas of canvases) {
    if (normalizeCanvasName(canvas.name) === normalizedCanvasName) {
      return canvas.id;
    }
  }

  return null;
}
