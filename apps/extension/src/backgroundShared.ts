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
