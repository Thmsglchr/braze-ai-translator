(() => {
  const runtime = getAdapterRuntime();

  runtime.createGenericPageAdapter = () => ({
    id: "generic-page",
    label: "Generic Page",
    detect(): AdapterDetection | null {
      const selectedText = runtime.normalizeMultilineText(runtime.getSelectedText());

      if (selectedText.length > 0) {
        return {
          adapterId: "generic-page",
          adapterLabel: "Generic Page",
          pageType: "generic-selection",
          isBrazePage: false,
          canExtract: true,
          contentSource: "selection",
          detectedChannel: null,
          detectedEditorType: null,
          candidateCount: 1,
          extractedTextPreview: selectedText.slice(0, 240),
          notes: []
        };
      }

      const visibleText = runtime.collectVisibleText();

      if (visibleText.length === 0) {
        return null;
      }

      return {
        adapterId: "generic-page",
        adapterLabel: "Generic Page",
        pageType: "generic-visible-text",
        isBrazePage: false,
        canExtract: true,
        contentSource: "visible_text",
        detectedChannel: null,
        detectedEditorType: null,
        candidateCount: 1,
        extractedTextPreview: visibleText.slice(0, 240),
        notes: []
      };
    },
    async extract(detection: AdapterDetection): Promise<AdapterExtractionResult | null> {
      const selectedText = runtime.normalizeMultilineText(runtime.getSelectedText());
      const visibleText = runtime.collectVisibleText();
      const extractedText =
        detection.contentSource === "selection" ? selectedText : visibleText;

      if (extractedText.length === 0) {
        return null;
      }

      return {
        rawContent: extractedText,
        messageChannel: "email",
        contentFieldKey:
          detection.contentSource === "selection"
            ? "debug.selection_text"
            : "debug.visible_text",
        contentFieldType: "plain_text",
        sourceLocale: runtime.normalizeLocale(document.documentElement.lang),
        sourceMessageIdHint: window.location.href,
        notes: []
      };
    },
    async applyTransformedContent(): Promise<AdapterApplyResult> {
      return {
        applied: false,
        message:
          "Automatic write-back is only supported for the Braze adapter in this POC.",
        targetDescription: "generic page",
        notes: [
          {
            code: "writeback_unsupported",
            severity: "warning",
            message:
              "The generic fallback adapter stays read-only and does not write content back into the page."
          }
        ]
      };
    }
  });
})();
