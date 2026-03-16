type SchemaBrazeMessageChannel =
  import("@braze-ai-translator/schemas").BrazeMessageChannel;
type SchemaContentFieldType =
  import("@braze-ai-translator/schemas").ContentFieldType;

declare global {
  type BrazeMessageChannel = SchemaBrazeMessageChannel;
  type ContentFieldType = SchemaContentFieldType;

  type AdapterContentSource = "selection" | "visible_text" | "editor_text";
  type AdapterNoteSeverity = "info" | "warning";

  interface AdapterNote {
    readonly code: string;
    readonly severity: AdapterNoteSeverity;
    readonly message: string;
  }

  interface AdapterDetection {
    readonly adapterId: string;
    readonly adapterLabel: string;
    readonly pageType: string;
    readonly isBrazePage: boolean;
    readonly canExtract: boolean;
    readonly contentSource: AdapterContentSource;
    readonly detectedChannel: BrazeMessageChannel | null;
    readonly detectedEditorType: string | null;
    readonly candidateCount: number;
    readonly extractedTextPreview: string;
    readonly notes: readonly AdapterNote[];
  }

  interface AdapterExtractionResult {
    readonly rawContent: string;
    readonly messageChannel: BrazeMessageChannel;
    readonly contentFieldKey: string;
    readonly contentFieldType: ContentFieldType;
    readonly sourceLocale: string;
    readonly sourceMessageIdHint: string;
    readonly sourceCampaignIdHint?: string;
    readonly sourceCanvasIdHint?: string;
    readonly sourceMessageVariantIdHint?: string;
    readonly notes: readonly AdapterNote[];
  }

  interface AdapterApplyResult {
    readonly applied: boolean;
    readonly message: string;
    readonly targetDescription: string;
    readonly notes: readonly AdapterNote[];
  }

  interface PageAdapter {
    readonly id: string;
    readonly label: string;
    detect(): AdapterDetection | null;
    extract(detection: AdapterDetection): Promise<AdapterExtractionResult | null>;
    applyTransformedContent(
      detection: AdapterDetection,
      transformResult: import("@braze-ai-translator/schemas").TransformResult
    ): Promise<AdapterApplyResult>;
  }

  interface AdapterSelection {
    readonly activeDetection: AdapterDetection | null;
    readonly detections: readonly AdapterDetection[];
  }

  interface AdapterRuntime {
    readonly overlayRootAttribute: string;
    createGenericPageAdapter: (() => PageAdapter) | null;
    createBrazePageAdapter: (() => PageAdapter) | null;
    normalizeMultilineText(value: string): string;
    normalizeLocale(rawLocale: string): string;
    containsLiquidSyntax(value: string): boolean;
    getSelectedText(): string;
    isElementVisible(element: Element | null): element is HTMLElement;
    shouldIncludeTextNode(textNode: Text): boolean;
    collectVisibleText(root?: ParentNode | null): string;
    collectElementText(element: HTMLElement): string;
    getElementSignalText(element: Element): string;
    normalizeExtensionRuntimeError(error: unknown): string | null;
  }

  type BrazeWriteMode = "value" | "textContent" | "innerHTML";

  interface BrazeWritePlanInput {
    readonly tagName: string;
    readonly isContentEditable: boolean;
    readonly editorType: string | null;
    readonly contentFieldType: ContentFieldType;
  }

  interface BrazeWritePlan {
    readonly mode: BrazeWriteMode;
    readonly description: string;
  }

  interface BrazeApplyGuardResult {
    readonly canApply: boolean;
    readonly message: string;
  }

  interface BrazeCandidateSelectionInput {
    readonly score: number;
    readonly contentFieldKey: string;
    readonly text: string;
    readonly isFocused: boolean;
  }

  interface BrazeCandidateSelectionResult {
    readonly selectedIndex: number | null;
    readonly reason: "none" | "focused" | "highest_score" | "ambiguous";
  }

  interface BrazeInputCandidateFilterInput {
    readonly tagName: string;
    readonly signalText: string;
    readonly isBeeStagePage: boolean;
  }

  interface BrazeEditableContentInput {
    readonly html: string;
    readonly text: string;
    readonly contentFieldType: ContentFieldType;
  }

  interface BrazeEditableContentResult {
    readonly rawContent: string;
    readonly previewText: string;
    readonly contentFieldType: ContentFieldType;
  }

  interface BrazePreviewDocumentResult {
    readonly documentHtml: string;
    readonly rawContent: string;
    readonly previewText: string;
  }

  interface BrazeAdapterSharedApi {
    validateTransformForApply(
      transformResult: Pick<
        import("@braze-ai-translator/schemas").TransformResult,
        "transformStatus" | "transformedContent" | "validationErrors"
      >
    ): BrazeApplyGuardResult;
    resolveWritePlan(input: BrazeWritePlanInput): BrazeWritePlan | null;
    selectCandidateIndex(
      candidates: readonly BrazeCandidateSelectionInput[]
    ): BrazeCandidateSelectionResult;
    shouldDiscardCandidateText(text: string): boolean;
    shouldSkipInputCandidate(
      input: BrazeInputCandidateFilterInput
    ): boolean;
    normalizeEditableContent(
      input: BrazeEditableContentInput
    ): BrazeEditableContentResult;
    extractPreviewDocumentContent(documentHtml: string): BrazePreviewDocumentResult;
    injectPreviewDocumentContent(documentHtml: string, bodyHtml: string): string;
  }

  function getAdapterRuntime(): AdapterRuntime;
  function getBrazeAdapterShared(): BrazeAdapterSharedApi;
}

export {};
