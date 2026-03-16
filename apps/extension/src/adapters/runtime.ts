interface AdapterRuntimeHost {
  __brazeAiExtensionAdapterRuntime?: AdapterRuntime;
}

function getAdapterRuntime(): AdapterRuntime {
  const runtimeHost = globalThis as typeof globalThis & AdapterRuntimeHost;

  if (runtimeHost.__brazeAiExtensionAdapterRuntime !== undefined) {
    return runtimeHost.__brazeAiExtensionAdapterRuntime;
  }

  const overlayRootAttribute = "data-braze-ai-extension-root";

  const runtime: AdapterRuntime = {
    overlayRootAttribute,
    createGenericPageAdapter: null,
    createBrazePageAdapter: null,
    normalizeMultilineText(value: string): string {
      return value
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter((line) => line.length > 0)
        .join("\n");
    },
    normalizeLocale(rawLocale: string): string {
      const normalizedLocale = rawLocale.trim().replaceAll("_", "-");

      if (
        normalizedLocale.length === 0 ||
        !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalizedLocale)
      ) {
        return "und";
      }

      return normalizedLocale;
    },
    containsLiquidSyntax(value: string): boolean {
      return value.includes("{{") || value.includes("{%");
    },
    getSelectedText(): string {
      return window.getSelection()?.toString() ?? "";
    },
    isElementVisible(element: Element | null): element is HTMLElement {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      if (
        element.closest(`[${overlayRootAttribute}]`) !== null ||
        element.closest("script,style,noscript,template,head,title") !== null ||
        element.closest("[hidden],[aria-hidden='true']") !== null
      ) {
        return false;
      }

      const computedStyle = window.getComputedStyle(element);

      return (
        computedStyle.display !== "none" &&
        computedStyle.visibility !== "hidden"
      );
    },
    shouldIncludeTextNode(textNode: Text): boolean {
      const parentElement = textNode.parentElement;

      if (parentElement === null || !runtime.isElementVisible(parentElement)) {
        return false;
      }

      return runtime.normalizeMultilineText(textNode.textContent ?? "").length > 0;
    },
    collectVisibleText(root: ParentNode | null = document.body): string {
      if (root === null) {
        return "";
      }

      const textChunks: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

      while (true) {
        const currentNode = walker.nextNode();

        if (currentNode === null) {
          break;
        }

        const textNode = currentNode as Text;

        if (!runtime.shouldIncludeTextNode(textNode)) {
          continue;
        }

        const normalizedText = runtime.normalizeMultilineText(
          textNode.textContent ?? ""
        );

        if (normalizedText.length > 0) {
          textChunks.push(normalizedText);
        }
      }

      return runtime.normalizeMultilineText(textChunks.join("\n"));
    },
    collectElementText(element: HTMLElement): string {
      if (element instanceof HTMLTextAreaElement) {
        return runtime.normalizeMultilineText(element.value);
      }

      if (element instanceof HTMLInputElement) {
        return runtime.normalizeMultilineText(element.value);
      }

      const innerTextValue = runtime.normalizeMultilineText(element.innerText);

      if (innerTextValue.length > 0) {
        return innerTextValue;
      }

      return runtime.normalizeMultilineText(element.textContent ?? "");
    },
    getElementSignalText(element: Element): string {
      if (!(element instanceof HTMLElement)) {
        return "";
      }

      const signalValues = [
        element.id,
        element.className,
        element.getAttribute("data-testid") ?? "",
        element.getAttribute("data-test-id") ?? "",
        element.getAttribute("data-qa") ?? "",
        element.getAttribute("data-name") ?? "",
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("aria-roledescription") ?? "",
        element.getAttribute("placeholder") ?? "",
        element.getAttribute("name") ?? "",
        element.getAttribute("role") ?? ""
      ];

      const labelId = element.getAttribute("aria-labelledby");

      if (labelId !== null) {
        labelId
          .split(/\s+/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .forEach((id) => {
            signalValues.push(
              runtime.normalizeMultilineText(
                document.getElementById(id)?.textContent ?? ""
              )
            );
          });
      }

      for (
        let currentParent = element.parentElement, depth = 0;
        currentParent !== null && depth < 5;
        currentParent = currentParent.parentElement, depth += 1
      ) {
        signalValues.push(
          currentParent.id,
          currentParent.className,
          currentParent.getAttribute("data-testid") ?? "",
          currentParent.getAttribute("data-qa") ?? "",
          currentParent.getAttribute("data-name") ?? "",
          currentParent.getAttribute("aria-label") ?? "",
          currentParent.getAttribute("aria-roledescription") ?? ""
        );
      }

      return runtime.normalizeMultilineText(signalValues.join(" "));
    },
    normalizeExtensionRuntimeError(error: unknown): string | null {
      const message =
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : typeof error === "string"
            ? error
            : null;

      if (message === null) {
        return null;
      }

      if (message.includes("Extension context invalidated")) {
        return (
          "The extension was reloaded or updated while this page was open. " +
          "Refresh the Braze page and reopen the extension."
        );
      }

      return message;
    }
  };

  runtimeHost.__brazeAiExtensionAdapterRuntime = runtime;

  return runtime;
}
