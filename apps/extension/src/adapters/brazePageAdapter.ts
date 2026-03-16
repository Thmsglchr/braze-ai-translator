interface BrazeEditorCandidate {
  readonly element: HTMLElement;
  readonly container: HTMLElement | null;
  readonly rawContent: string;
  readonly previewText: string;
  readonly previewDocumentHtml?: string;
  readonly score: number;
  readonly contentFieldKey: string;
  readonly contentFieldType: ContentFieldType;
  readonly messageChannel: BrazeMessageChannel | null;
  readonly editorType: string | null;
  readonly signalText: string;
}

interface BrazeModuleEditor {
  readonly element: HTMLElement;
  readonly moduleContainer: HTMLElement | null;
  readonly moduleType: string;
  readonly innerHTML: string;
  readonly textContent: string;
}

interface BrazeModuleWriteResult {
  readonly element: HTMLElement;
  readonly moduleType: string;
  readonly entriesApplied: readonly string[];
}

interface BrazePageContext {
  readonly pageType: string;
  readonly channel: BrazeMessageChannel | null;
  readonly notes: readonly AdapterNote[];
  readonly sourceCampaignIdHint?: string;
  readonly sourceCanvasIdHint?: string;
  readonly sourceMessageVariantIdHint?: string;
  readonly sourceMessageIdHint: string;
}

interface ResolvedBrazeCandidate {
  readonly context: BrazePageContext;
  readonly candidate: BrazeEditorCandidate;
}

interface BrazeCandidateSelection {
  readonly selectedCandidate: BrazeEditorCandidate | null;
  readonly candidateCount: number;
  readonly reason: BrazeCandidateSelectionResult["reason"];
}

(() => {
  const runtime = getAdapterRuntime();
  const shared = getBrazeAdapterShared();
  let lastResolvedCandidate: ResolvedBrazeCandidate | null = null;

  runtime.createBrazePageAdapter = () => ({
    id: "braze-page",
    label: "Braze Page",
    detect(): AdapterDetection | null {
      const brazeSignal = getBrazeSignalState();

      if (!brazeSignal.isDetected) {
        lastResolvedCandidate = null;
        return null;
      }

      const context = buildBrazePageContext();
      const candidateSelection = chooseBrazeCandidate(context.channel);
      const selectedCandidate = candidateSelection.selectedCandidate;
      const selectedText = runtime.normalizeMultilineText(runtime.getSelectedText());
      const detectionNotes = [...context.notes];

      if (selectedText.length > 0 && selectedCandidate === null) {
        detectionNotes.push({
          code: "selection_without_supported_editor",
          severity: "warning",
          message:
            "Selected text was found, but no supported Braze editor region could be confirmed."
        });
      }

      if (selectedCandidate === null) {
        lastResolvedCandidate = null;
        detectionNotes.push(
          candidateSelection.reason === "ambiguous"
            ? {
                code: "multiple_braze_editors_detected",
                severity: "warning",
                message:
                  "Multiple editable Braze modules were found. Click inside the module you want to transform, then rerun."
              }
            : {
                code: "unsupported_braze_editor",
                severity: "warning",
                message:
                  "Braze was detected, but the current editor structure is ambiguous or unsupported in read-only mode."
              }
        );

        return {
          adapterId: "braze-page",
          adapterLabel: "Braze Page",
          pageType: context.pageType,
          isBrazePage: true,
          canExtract: false,
          contentSource: "editor_text",
          detectedChannel: context.channel,
          detectedEditorType: null,
          candidateCount: candidateSelection.candidateCount,
          extractedTextPreview: "",
          notes: detectionNotes
        };
      }

      if (context.channel === null && selectedCandidate.messageChannel === null) {
        lastResolvedCandidate = null;
        detectionNotes.push({
          code: "ambiguous_channel",
          severity: "warning",
          message:
            "Braze editor content was found, but the message channel could not be inferred reliably."
        });

        return {
          adapterId: "braze-page",
          adapterLabel: "Braze Page",
          pageType: context.pageType,
          isBrazePage: true,
          canExtract: false,
          contentSource: "editor_text",
          detectedChannel: null,
          detectedEditorType: selectedCandidate.editorType,
          candidateCount: candidateSelection.candidateCount,
          extractedTextPreview: selectedCandidate.previewText.slice(0, 240),
          notes: detectionNotes
        };
      }

      if (selectedCandidate.score < 60) {
        lastResolvedCandidate = null;
        detectionNotes.push({
          code: "low_confidence_editor_match",
          severity: "warning",
          message:
            "A possible Braze editor was found, but the signal quality is too weak for safe extraction."
        });

        return {
          adapterId: "braze-page",
          adapterLabel: "Braze Page",
          pageType: context.pageType,
          isBrazePage: true,
          canExtract: false,
          contentSource: "editor_text",
          detectedChannel: selectedCandidate.messageChannel ?? context.channel,
          detectedEditorType: selectedCandidate.editorType,
          candidateCount: candidateSelection.candidateCount,
          extractedTextPreview: selectedCandidate.previewText.slice(0, 240),
          notes: detectionNotes
        };
      }

      if (candidateSelection.reason === "focused") {
        detectionNotes.push({
          code: "focused_braze_editor_selected",
          severity: "info",
          message: "Using the currently focused Braze editor module."
        });
      }

      if (selectedCandidate.editorType === "preview_iframe") {
        detectionNotes.push({
          code: "braze_preview_iframe_selected",
          severity: "info",
          message: "Using the rendered Braze preview iframe as the canonical email HTML source."
        });
      }

      detectionNotes.push({
        code: "braze_editor_selected",
        severity: "info",
        message: `Selected the most likely Braze editor candidate for ${selectedCandidate.contentFieldKey}.`
      });

      lastResolvedCandidate = {
        context,
        candidate: selectedCandidate
      };

      return {
        adapterId: "braze-page",
        adapterLabel: "Braze Page",
        pageType: context.pageType,
        isBrazePage: true,
        canExtract: true,
        contentSource: "editor_text",
        detectedChannel: selectedCandidate.messageChannel ?? context.channel,
        detectedEditorType: selectedCandidate.editorType,
        candidateCount: candidateSelection.candidateCount,
        extractedTextPreview: selectedCandidate.previewText.slice(0, 240),
        notes: detectionNotes
      };
    },
    async extract(detection: AdapterDetection): Promise<AdapterExtractionResult | null> {
      const resolvedCandidate = resolveBrazeCandidateForWrite(detection);

      if (resolvedCandidate === null) {
        return null;
      }

      const messageChannel =
        resolvedCandidate.candidate.messageChannel ?? resolvedCandidate.context.channel;

      if (messageChannel === null) {
        return null;
      }

      return {
        rawContent: resolvedCandidate.candidate.rawContent,
        messageChannel,
        contentFieldKey: resolvedCandidate.candidate.contentFieldKey,
        contentFieldType: resolvedCandidate.candidate.contentFieldType,
        sourceLocale: runtime.normalizeLocale(document.documentElement.lang),
        sourceMessageIdHint: resolvedCandidate.context.sourceMessageIdHint,
        sourceCampaignIdHint: resolvedCandidate.context.sourceCampaignIdHint,
        sourceCanvasIdHint: resolvedCandidate.context.sourceCanvasIdHint,
        sourceMessageVariantIdHint: resolvedCandidate.context.sourceMessageVariantIdHint,
        notes: [
          ...resolvedCandidate.context.notes,
          {
            code: "braze_editor_extracted",
            severity: "info",
            message: `Extracted ${resolvedCandidate.candidate.contentFieldKey} from the inferred ${resolvedCandidate.candidate.editorType ?? "editor"} surface.`
          }
        ]
      };
    },
    async applyTransformedContent(
      detection: AdapterDetection,
      transformResult
    ): Promise<AdapterApplyResult> {
      const applyGuard = shared.validateTransformForApply(transformResult);

      if (!applyGuard.canApply) {
        return {
          applied: false,
          message: applyGuard.message,
          targetDescription: "braze editor",
          notes: [
            {
              code: "writeback_blocked",
              severity: "warning",
              message: applyGuard.message
            }
          ]
        };
      }

      const resolvedCandidate = resolveBrazeCandidateForWrite(detection);

      if (resolvedCandidate === null) {
        return {
          applied: false,
          message:
            "Braze was detected, but the editor candidate became ambiguous before write-back.",
          targetDescription: "braze editor",
          notes: [
            {
              code: "writeback_ambiguous",
              severity: "warning",
              message:
                "The editor candidate changed or could not be confirmed, so nothing was written back."
            }
          ]
        };
      }

      if (resolvedCandidate.candidate.rawContent !== transformResult.originalContent) {
        return {
          applied: false,
          message:
            "The editor content changed after extraction, so write-back was skipped.",
          targetDescription: describeCandidateTarget(resolvedCandidate.candidate),
          notes: [
            {
              code: "writeback_stale_source",
              severity: "warning",
              message:
                "The current editor content no longer matches the content that was sent to /transform."
            }
          ]
        };
      }

      const transformedContent = transformResult.transformedContent;

      if (transformedContent === null) {
        return {
          applied: false,
          message:
            "The backend returned no transformed content, so nothing was written back.",
          targetDescription: describeCandidateTarget(resolvedCandidate.candidate),
          notes: [
            {
              code: "writeback_missing_content",
              severity: "warning",
              message:
                "The transform result did not include transformed content."
            }
          ]
        };
      }

      if (
        resolvedCandidate.candidate.editorType === "preview_iframe" &&
        resolvedCandidate.candidate.element instanceof HTMLIFrameElement
      ) {
        const previewDocumentHtml =
          resolvedCandidate.candidate.previewDocumentHtml ?? transformedContent;
        const nextPreviewDocumentHtml = shared.injectPreviewDocumentContent(
          previewDocumentHtml,
          transformedContent
        );
        const nextPreviewDocument = shared.extractPreviewDocumentContent(
          nextPreviewDocumentHtml
        );

        writeContentToPreviewIframe(
          resolvedCandidate.candidate.element,
          nextPreviewDocument.documentHtml
        );
        lastResolvedCandidate = {
          context: resolvedCandidate.context,
          candidate: {
            ...resolvedCandidate.candidate,
            rawContent: nextPreviewDocument.rawContent,
            previewText: nextPreviewDocument.previewText,
            previewDocumentHtml: nextPreviewDocument.documentHtml
          }
        };

        const moduleEditors = collectTranslatableModuleEditors();
        const translationEntries = transformResult.translationEntries;

        if (moduleEditors.length === 0 || translationEntries.length === 0) {
          return {
            applied: true,
            message:
              moduleEditors.length === 0
                ? "Wrote transformed content to the preview iframe. No module editors were found for persistent write-back."
                : "Wrote transformed content to the preview iframe.",
            targetDescription: "braze email preview iframe",
            notes: [
              {
                code: "writeback_applied_preview_iframe",
                severity: "info",
                message:
                  "Applied transformed HTML to the rendered Braze preview iframe."
              },
              ...(moduleEditors.length === 0
                ? [
                    {
                      code: "writeback_no_module_editors",
                      severity: "warning" as const,
                      message:
                        "No TinyMCE module editors were found on the page. The preview was updated but the change may not persist in Braze."
                    }
                  ]
                : [])
            ]
          };
        }

        const writeResults = applyTranslationEntriesToModuleEditors(
          moduleEditors,
          translationEntries
        );
        const totalApplied = writeResults.reduce(
          (sum, result) => sum + result.entriesApplied.length,
          0
        );
        const verificationNotes = verifyModuleEditorWrites(writeResults);

        return {
          applied: totalApplied > 0,
          message:
            totalApplied > 0
              ? `Applied ${totalApplied} translation tag(s) to ${writeResults.length} module editor(s).`
              : "Preview was updated but no translation entries could be matched to module editors.",
          targetDescription: "braze module editors",
          notes: [
            {
              code: "writeback_applied_preview_iframe",
              severity: "info",
              message:
                "Applied transformed HTML to the rendered Braze preview iframe."
            },
            {
              code:
                totalApplied > 0
                  ? "writeback_applied_module_editors"
                  : "writeback_no_module_match",
              severity: totalApplied > 0 ? "info" : "warning",
              message:
                totalApplied > 0
                  ? `Wrote ${totalApplied} translation tag(s) into ${writeResults.length} TinyMCE module editor root(s).`
                  : "No translation entries matched any visible module editor content."
            },
            ...verificationNotes
          ]
        };
      }

      const writePlan = shared.resolveWritePlan({
        tagName: resolvedCandidate.candidate.element.tagName.toLowerCase(),
        isContentEditable: resolvedCandidate.candidate.element.isContentEditable,
        editorType: resolvedCandidate.candidate.editorType,
        contentFieldType: resolvedCandidate.candidate.contentFieldType
      });

      if (writePlan === null) {
        return {
          applied: false,
          message:
            "The detected editor type is not supported for automatic write-back yet.",
          targetDescription: describeCandidateTarget(resolvedCandidate.candidate),
          notes: [
            {
              code: "writeback_unsupported_editor",
              severity: "warning",
              message:
                "The detected Braze editor surface is not a supported write target."
            }
          ]
        };
      }

      writeContentToCandidate(
        resolvedCandidate.candidate.element,
        transformedContent,
        writePlan.mode
      );
      dispatchEditorChangeEvents(resolvedCandidate.candidate.element);
      lastResolvedCandidate = {
        context: resolvedCandidate.context,
        candidate: {
          ...resolvedCandidate.candidate,
          rawContent: transformedContent,
          previewText: runtime.normalizeMultilineText(
            resolvedCandidate.candidate.element.textContent ?? transformedContent
          )
        }
      };

      return {
        applied: true,
        message: `Wrote transformed content back into the ${writePlan.description}.`,
        targetDescription: describeCandidateTarget(resolvedCandidate.candidate),
        notes: [
          {
            code: "writeback_applied",
            severity: "info",
            message: `Applied transformed content to ${resolvedCandidate.candidate.contentFieldKey} using ${writePlan.mode}.`
          }
        ]
      };
    }
  });

  function resolveBrazeCandidateForWrite(
    detection: AdapterDetection
  ): ResolvedBrazeCandidate | null {
    if (
      lastResolvedCandidate !== null &&
      lastResolvedCandidate.candidate.element.isConnected &&
      matchesDetection(lastResolvedCandidate.candidate, detection)
    ) {
      return lastResolvedCandidate;
    }

    const context = buildBrazePageContext();
    const candidateSelection = chooseBrazeCandidate(context.channel);
    const candidate = candidateSelection.selectedCandidate;

    if (candidate === null || !matchesDetection(candidate, detection)) {
      lastResolvedCandidate = null;
      return null;
    }

    lastResolvedCandidate = {
      context,
      candidate
    };

    return lastResolvedCandidate;
  }

  function matchesDetection(
    candidate: BrazeEditorCandidate,
    detection: AdapterDetection
  ): boolean {
    return (
      detection.adapterId === "braze-page" &&
      detection.detectedEditorType === candidate.editorType &&
      detection.detectedChannel === candidate.messageChannel &&
      detection.extractedTextPreview === candidate.previewText.slice(0, 240)
    );
  }

  function getBrazeSignalState(): {
    readonly isDetected: boolean;
    readonly notes: readonly AdapterNote[];
  } {
    const locationHost = window.location.host.toLowerCase();
    const pageTitle = runtime.normalizeMultilineText(document.title).toLowerCase();
    const isBrazeHost =
      /(^|\.)((dashboard|app)\.)?braze\.com$/.test(locationHost) ||
      /(^|\.)appboy\.com$/.test(locationHost);
    const hasBrazeTitle = pageTitle.includes("braze");
    const hasBrazeDomSignal =
      document.querySelector(
        [
          "[data-testid*='braze' i]",
          "[class*='braze' i]",
          "[id*='braze' i]",
          "[data-testid*='campaign' i]",
          "[data-testid*='canvas' i]",
          "[data-testid*='editor' i]"
        ].join(",")
      ) !== null;
    const notes: AdapterNote[] = [];

    if (isBrazeHost) {
      notes.push({
        code: "braze_host_detected",
        severity: "info",
        message: "Detected a Braze host name."
      });
    }

    if (hasBrazeTitle) {
      notes.push({
        code: "braze_title_detected",
        severity: "info",
        message: "Detected Braze in the page title."
      });
    }

    if (hasBrazeDomSignal) {
      notes.push({
        code: "braze_dom_detected",
        severity: "info",
        message: "Detected Braze-like editor DOM signals."
      });
    }

    return {
      isDetected: isBrazeHost || hasBrazeTitle || hasBrazeDomSignal,
      notes
    };
  }

  function buildBrazePageContext(): BrazePageContext {
    const url = new URL(window.location.href);
    const notes = [...getBrazeSignalState().notes];
    const pageType = inferBrazePageType(url);
    const channel = inferBrazeChannel(url, document.title, "");
    const sourceCampaignIdHint = extractIdHint(url, ["campaigns"], ["campaign_id"]);
    const sourceCanvasIdHint = extractIdHint(url, ["canvases"], ["canvas_id"]);
    const sourceMessageVariantIdHint = extractQueryHint(url, [
      "message_variation_id",
      "message_variant_id",
      "variant_id"
    ]);
    const sourceMessageIdHint =
      extractQueryHint(url, ["message_id", "dispatch_id"]) ??
      sourceMessageVariantIdHint ??
      sourceCampaignIdHint ??
      sourceCanvasIdHint ??
      `${pageType}:${url.href}`;

    notes.push({
      code: "braze_page_type_inferred",
      severity: "info",
      message: `Inferred page type ${pageType}.`
    });

    if (channel !== null) {
      notes.push({
        code: "braze_channel_inferred",
        severity: "info",
        message: `Inferred message channel ${channel}.`
      });
    }

    return {
      pageType,
      channel,
      notes,
      sourceCampaignIdHint,
      sourceCanvasIdHint,
      sourceMessageVariantIdHint,
      sourceMessageIdHint
    };
  }

  function chooseBrazeCandidate(
    pageChannel: BrazeMessageChannel | null
  ): BrazeCandidateSelection {
    const candidates = collectBrazeCandidates(pageChannel);

    if (candidates.length === 0) {
      return {
        selectedCandidate: null,
        candidateCount: 0,
        reason: "none"
      };
    }

    const selectionResult = shared.selectCandidateIndex(
      candidates.map((candidate) => ({
        score: candidate.score,
        contentFieldKey: candidate.contentFieldKey,
        text: candidate.previewText,
        isFocused: isBrazeCandidateFocused(candidate)
      }))
    );

    return {
      selectedCandidate:
        selectionResult.selectedIndex === null
          ? null
          : candidates[selectionResult.selectedIndex] ?? null,
      candidateCount: candidates.length,
      reason: selectionResult.reason
    };
  }

  function collectBrazeCandidates(
    pageChannel: BrazeMessageChannel | null
  ): BrazeEditorCandidate[] {
    const previewCandidates = collectBrazePreviewCandidates(pageChannel);

    if (previewCandidates.length > 0) {
      return previewCandidates;
    }

    const editorContainers = collectBrazeEditorContainers();
    const isBeeStagePage = editorContainers.some((container) =>
      container.matches("[aria-roledescription='stage module'], .module-box, [data-name='Content']")
    );
    const candidateSelectors = [
      "textarea",
      "input[type='text']",
      "input:not([type])",
      "[contenteditable='true']",
      "[role='textbox']",
      "[data-qa='tinyeditor-root-element']",
      "[data-testid*='editor' i]",
      "[class*='editor' i]",
      "[id*='editor' i]",
      "[data-testid*='subject' i]",
      "[data-testid*='preheader' i]"
    ].join(",");
    const seenElements = new Set<HTMLElement>();
    const seenKeys = new Set<string>();
    const candidates: BrazeEditorCandidate[] = [];

    document.querySelectorAll(candidateSelectors).forEach((candidateNode) => {
      if (!(candidateNode instanceof HTMLElement)) {
        return;
      }

      if (seenElements.has(candidateNode) || !runtime.isElementVisible(candidateNode)) {
        return;
      }

      if (
        candidateNode.closest(`[${runtime.overlayRootAttribute}]`) !== null ||
        candidateNode.closest("nav,header,aside,footer") !== null
      ) {
        return;
      }

      const container = findCandidateContainer(candidateNode, editorContainers);

      if (editorContainers.length > 0 && container === null) {
        return;
      }

      const text = runtime.collectElementText(candidateNode);

      if (text.length === 0) {
        return;
      }

      const signalText = getCandidateSignalText(candidateNode, container).toLowerCase();

      if (
        isDiscardedBrazeCandidate(signalText) ||
        shared.shouldDiscardCandidateText(text) ||
        shared.shouldSkipInputCandidate({
          tagName: candidateNode.tagName.toLowerCase(),
          signalText,
          isBeeStagePage
        })
      ) {
        return;
      }

      const inferredField = inferBrazeField(signalText, pageChannel, candidateNode.innerHTML);
      const normalizedContent = shared.normalizeEditableContent({
        html: candidateNode.innerHTML,
        text,
        contentFieldType: inferredField.contentFieldType
      });

      if (
        shared.shouldDiscardCandidateText(normalizedContent.previewText) ||
        shared.shouldDiscardCandidateText(normalizedContent.rawContent)
      ) {
        return;
      }

      const inferredChannel =
        inferredField.messageChannel ?? inferBrazeChannel(window.location, document.title, signalText);
      const editorType = inferEditorType(candidateNode, signalText);
      const score = scoreBrazeCandidate(
        candidateNode,
        signalText,
        normalizedContent.previewText,
        {
          contentFieldKey: inferredField.contentFieldKey,
          contentFieldType: normalizedContent.contentFieldType
        },
        isBeeStagePage
      );
      const dedupeKey = [
        inferredField.contentFieldKey,
        inferredChannel ?? "unknown",
        normalizedContent.rawContent
      ].join("::");

      if (seenKeys.has(dedupeKey)) {
        return;
      }

      seenKeys.add(dedupeKey);
      seenElements.add(candidateNode);
      candidates.push({
        element: candidateNode,
        container,
        rawContent: normalizedContent.rawContent,
        previewText: normalizedContent.previewText,
        score,
        contentFieldKey: inferredField.contentFieldKey,
        contentFieldType: normalizedContent.contentFieldType,
        messageChannel: inferredChannel,
        editorType,
        signalText
      });
    });

    return candidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.previewText.length - left.previewText.length;
    });
  }

  function collectBrazePreviewCandidates(
    pageChannel: BrazeMessageChannel | null
  ): BrazeEditorCandidate[] {
    const candidates: BrazeEditorCandidate[] = [];

    document
      .querySelectorAll("iframe[data-cy='email-preview'], iframe[srcdoc]")
      .forEach((node) => {
        if (!(node instanceof HTMLIFrameElement) || !runtime.isElementVisible(node)) {
          return;
        }

        const rawContent = getBrazePreviewHtml(node);

        if (rawContent.length === 0) {
          return;
        }

        const previewDocument = shared.extractPreviewDocumentContent(rawContent);

        if (shared.shouldDiscardCandidateText(previewDocument.previewText)) {
          return;
        }

        const signalText = runtime.normalizeMultilineText(
          [
            runtime.getElementSignalText(node),
            node.getAttribute("data-cy") ?? "",
            node.getAttribute("title") ?? "",
            "email preview iframe srcdoc rendered html"
          ].join(" ")
        ).toLowerCase();
        const normalizedContent = shared.normalizeEditableContent({
          html: previewDocument.rawContent,
          text: previewDocument.previewText,
          contentFieldType: "html"
        });
        const inferredChannel =
          pageChannel ?? inferBrazeChannel(window.location, document.title, signalText) ?? "email";

        candidates.push({
          element: node,
          container:
            node.closest("section,article,form,[role='dialog'],main,fieldset") ??
            node.parentElement,
          rawContent: normalizedContent.rawContent,
          previewText: normalizedContent.previewText,
          previewDocumentHtml: previewDocument.documentHtml,
          score: 260,
          contentFieldKey: `braze.${inferredChannel}.body`,
          contentFieldType: "html",
          messageChannel: inferredChannel,
          editorType: "preview_iframe",
          signalText
        });
      });

    return candidates;
  }

  function collectBrazeEditorContainers(): readonly HTMLElement[] {
    const containers = new Set<HTMLElement>();
    const containerSelectors = [
      "[aria-roledescription='stage module']",
      ".module-box",
      "[data-name='Content']",
      "[data-testid*='editor' i]",
      "[data-testid*='compose' i]",
      "[data-testid*='message' i]",
      "[class*='editor' i]",
      "[id*='editor' i]",
      "[class*='compose' i]",
      "[data-testid*='subject' i]",
      "[data-testid*='preheader' i]"
    ].join(",");

    document.querySelectorAll(containerSelectors).forEach((node) => {
      if (!(node instanceof HTMLElement) || !runtime.isElementVisible(node)) {
        return;
      }

      const scopedContainer =
        node.closest("section,article,form,[role='dialog'],main,fieldset") ?? node;

      if (scopedContainer instanceof HTMLElement) {
        containers.add(scopedContainer);
      }
    });

    return [...containers];
  }

  function findCandidateContainer(
    candidateNode: HTMLElement,
    editorContainers: readonly HTMLElement[]
  ): HTMLElement | null {
    for (const container of editorContainers) {
      if (container.contains(candidateNode)) {
        return container;
      }
    }

    return null;
  }

  function getBrazePreviewHtml(iframe: HTMLIFrameElement): string {
    const srcdocValue = iframe.srcdoc.trim();

    if (srcdocValue.length > 0) {
      return srcdocValue;
    }

    const attributeValue = iframe.getAttribute("srcdoc")?.trim() ?? "";

    if (attributeValue.length > 0) {
      return attributeValue;
    }

    return iframe.contentDocument?.documentElement?.outerHTML?.trim() ?? "";
  }

  function inferBrazePageType(url: URL): string {
    const pathname = url.pathname.toLowerCase();

    if (pathname.includes("/campaigns")) {
      return "braze-campaign-editor";
    }

    if (pathname.includes("/canvases")) {
      return "braze-canvas-editor";
    }

    if (pathname.includes("/templates")) {
      return "braze-template-editor";
    }

    return "braze-editor";
  }

  function inferBrazeChannel(
    url: URL | Location,
    titleText: string,
    signalText: string
  ): BrazeMessageChannel | null {
    const signalPool = [
      url.href,
      url.pathname,
      titleText,
      signalText
    ]
      .join(" ")
      .toLowerCase();

    if (signalPool.includes("content card") || signalPool.includes("content_card")) {
      return "content_card";
    }

    if (signalPool.includes("in-app") || signalPool.includes("in_app")) {
      return "in_app";
    }

    if (signalPool.includes("push")) {
      return "push";
    }

    if (signalPool.includes("sms")) {
      return "sms";
    }

    if (signalPool.includes("webhook")) {
      return "webhook";
    }

    if (
      signalPool.includes("email") ||
      signalPool.includes("subject") ||
      signalPool.includes("preheader") ||
      signalPool.includes("html")
    ) {
      return "email";
    }

    return null;
  }

  function inferBrazeField(
    signalText: string,
    pageChannel: BrazeMessageChannel | null,
    html: string
  ): {
    readonly contentFieldKey: string;
    readonly contentFieldType: ContentFieldType;
    readonly messageChannel: BrazeMessageChannel | null;
  } {
    const normalizedSignal = signalText.toLowerCase();

    if (normalizedSignal.includes("subject")) {
      return {
        contentFieldKey: "braze.email.subject",
        contentFieldType: "subject",
        messageChannel: "email"
      };
    }

    if (normalizedSignal.includes("preheader")) {
      return {
        contentFieldKey: "braze.email.preheader",
        contentFieldType: "preheader",
        messageChannel: "email"
      };
    }

    if (normalizedSignal.includes("subtitle")) {
      return {
        contentFieldKey: `braze.${pageChannel ?? "content"}.subtitle`,
        contentFieldType: "subtitle",
        messageChannel: pageChannel
      };
    }

    if (
      normalizedSignal.includes("title") ||
      normalizedSignal.includes("headline")
    ) {
      return {
        contentFieldKey: `braze.${pageChannel ?? "content"}.title`,
        contentFieldType: "title",
        messageChannel: pageChannel
      };
    }

    if (normalizedSignal.includes("button")) {
      return {
        contentFieldKey: `braze.${pageChannel ?? "content"}.button`,
        contentFieldType: "plain_text",
        messageChannel: pageChannel
      };
    }

    if (normalizedSignal.includes("paragraph")) {
      return {
        contentFieldKey: `braze.${pageChannel ?? "content"}.body`,
        contentFieldType:
          normalizedSignal.includes("html") ||
          normalizedSignal.includes("liquid") ||
          /<[A-Za-z][\s\S]*>/.test(html)
            ? "html"
            : "plain_text",
        messageChannel: pageChannel
      };
    }

    return {
      contentFieldKey: `braze.${pageChannel ?? "message"}.body`,
      contentFieldType:
        normalizedSignal.includes("html") ||
        normalizedSignal.includes("code") ||
        normalizedSignal.includes("liquid") ||
        /<[A-Za-z][\s\S]*>/.test(html)
          ? "html"
          : "plain_text",
      messageChannel: pageChannel
    };
  }

  function inferEditorType(
    element: HTMLElement,
    signalText: string
  ): string | null {
    const normalizedSignal = signalText.toLowerCase();

    if (
      normalizedSignal.includes("monaco") ||
      normalizedSignal.includes("ace") ||
      normalizedSignal.includes("code") ||
      normalizedSignal.includes("html")
    ) {
      return "code_editor";
    }

    if (element instanceof HTMLTextAreaElement) {
      return "textarea";
    }

    if (element.isContentEditable || element.getAttribute("role") === "textbox") {
      return "rich_text";
    }

    if (element instanceof HTMLInputElement) {
      return "input";
    }

    return null;
  }

  function scoreBrazeCandidate(
    element: HTMLElement,
    signalText: string,
    text: string,
    inferredField: {
      readonly contentFieldKey: string;
      readonly contentFieldType: ContentFieldType;
    },
    isBeeStagePage: boolean
  ): number {
    const normalizedSignal = signalText.toLowerCase();
    let score = 0;

    if (element instanceof HTMLTextAreaElement) {
      score += 75;
    }

    if (element.isContentEditable) {
      score += 80;
    }

    if (element.getAttribute("role") === "textbox") {
      score += 50;
    }

    if (element instanceof HTMLInputElement) {
      score += 20;
    }

    if (isBeeTextEditorElement(element, normalizedSignal)) {
      score += 90;
    }

    if (isCandidateInSelectedBrazeModule(element)) {
      score += 35;
    }

    if (
      normalizedSignal.includes("editor") ||
      normalizedSignal.includes("compose") ||
      normalizedSignal.includes("message") ||
      normalizedSignal.includes("body")
    ) {
      score += 20;
    }

    if (
      normalizedSignal.includes("html") ||
      normalizedSignal.includes("liquid") ||
      normalizedSignal.includes("code")
    ) {
      score += 20;
    }

    if (normalizedSignal.includes("subject") || normalizedSignal.includes("preheader")) {
      score += 15;
    }

    if (normalizedSignal.includes("button")) {
      score += 20;
    }

    if (normalizedSignal.includes("paragraph")) {
      score += 20;
    }

    if (normalizedSignal.includes("title") || normalizedSignal.includes("heading")) {
      score += 20;
    }

    if (
      inferredField.contentFieldType === "plain_text" ||
      inferredField.contentFieldType === "html"
    ) {
      score += 15;
    }

    if (
      element.closest("section,article,form,[role='dialog'],main") !== null
    ) {
      score += 10;
    }

    if (
      isBeeStagePage &&
      element instanceof HTMLInputElement &&
      !normalizedSignal.includes("subject") &&
      !normalizedSignal.includes("preheader")
    ) {
      score -= 60;
    }

    score += Math.min(Math.floor(text.length / 80), 18);

    if (text.length < 12) {
      score -= 40;
    }

    return score;
  }

  function isDiscardedBrazeCandidate(signalText: string): boolean {
    return (
      signalText.includes("search") ||
      signalText.includes("filter") ||
      signalText.includes("segment") ||
      signalText.includes("audience") ||
      signalText.includes("tag ") ||
      signalText.includes("workspace") ||
      signalText.includes("quick link")
    );
  }

  function isBeeTextEditorElement(
    element: HTMLElement,
    signalText: string
  ): boolean {
    return (
      element.getAttribute("data-qa") === "tinyeditor-root-element" ||
      element.closest("[data-qa='tinyeditor-root-element']") !== null ||
      element.closest("[data-tiny-wrapper='true']") !== null ||
      signalText.includes("tinyeditor") ||
      signalText.includes("mce-content-body")
    );
  }

  function getCandidateSignalText(
    element: HTMLElement,
    container: HTMLElement | null
  ): string {
    const moduleContainer =
      element.closest("[aria-roledescription='stage module']") ??
      container?.closest("[aria-roledescription='stage module']") ??
      container;
    const moduleLabel =
      moduleContainer instanceof HTMLElement
        ? runtime.normalizeMultilineText(
            [
              moduleContainer.getAttribute("aria-label") ?? "",
              moduleContainer.getAttribute("data-name") ?? "",
              moduleContainer.className,
              moduleContainer
                .querySelector(".StageColumn_moduleLabel__u4zmN, .module-name-label--cs")
                ?.textContent ?? ""
            ].join(" ")
          )
        : "";

    return runtime.normalizeMultilineText(
      [runtime.getElementSignalText(element), moduleLabel].join(" ")
    );
  }

  function isCandidateInSelectedBrazeModule(element: HTMLElement): boolean {
    const moduleContainer = element.closest("[aria-roledescription='stage module']");

    if (!(moduleContainer instanceof HTMLElement)) {
      return false;
    }

    return (
      moduleContainer.classList.contains("module-box--selected") ||
      moduleContainer.classList.contains("selected") ||
      moduleContainer.getAttribute("tabindex") === "0"
    );
  }

  function describeCandidateTarget(candidate: BrazeEditorCandidate): string {
    return `${candidate.contentFieldKey}${candidate.editorType === null ? "" : ` (${candidate.editorType})`}`;
  }

  function isBrazeCandidateFocused(candidate: BrazeEditorCandidate): boolean {
    const focusNode = getCurrentFocusNode();

    if (focusNode === null) {
      return false;
    }

    const focusElement =
      focusNode instanceof HTMLElement ? focusNode : focusNode.parentElement;

    if (focusElement === null) {
      return false;
    }

    return (
      candidate.element.contains(focusNode) ||
      candidate.element.contains(focusElement) ||
      focusElement === candidate.element ||
      candidate.container?.contains(focusNode) === true ||
      candidate.container?.contains(focusElement) === true
    );
  }

  function getCurrentFocusNode(): Node | null {
    const selection = window.getSelection();

    if (selection?.rangeCount && selection.anchorNode !== null) {
      return selection.anchorNode;
    }

    return document.activeElement;
  }

  function writeContentToPreviewIframe(
    iframe: HTMLIFrameElement,
    transformedContent: string
  ): void {
    iframe.srcdoc = transformedContent;
    iframe.setAttribute("srcdoc", transformedContent);
  }

  function writeContentToCandidate(
    element: HTMLElement,
    transformedContent: string,
    writeMode: BrazeWriteMode
  ): void {
    if (
      writeMode === "value" &&
      (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)
    ) {
      setFormControlValue(element, transformedContent);
      return;
    }

    if (writeMode === "innerHTML") {
      element.innerHTML = transformedContent;
      return;
    }

    element.textContent = transformedContent;
  }

  function setFormControlValue(
    element: HTMLTextAreaElement | HTMLInputElement,
    nextValue: string
  ): void {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (valueSetter !== undefined) {
      valueSetter.call(element, nextValue);
      return;
    }

    element.value = nextValue;
  }

  function dispatchEditorChangeEvents(element: HTMLElement): void {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function collectTranslatableModuleEditors(): BrazeModuleEditor[] {
    const editors: BrazeModuleEditor[] = [];
    const seen = new Set<HTMLElement>();

    document
      .querySelectorAll("[data-qa='tinyeditor-root-element']")
      .forEach((node) => {
        if (!(node instanceof HTMLElement) || seen.has(node)) {
          return;
        }

        if (!runtime.isElementVisible(node)) {
          return;
        }

        if (node.closest(`[${runtime.overlayRootAttribute}]`) !== null) {
          return;
        }

        seen.add(node);

        const moduleContainer = node.closest(
          "[aria-roledescription='stage module']"
        );
        const moduleType = inferModuleTypeFromContainer(
          moduleContainer instanceof HTMLElement ? moduleContainer : null
        );

        if (isNonTranslatableModuleType(moduleType)) {
          return;
        }

        const textContent = runtime.collectElementText(node).trim();

        if (!isTranslatableModuleContent(textContent)) {
          return;
        }

        editors.push({
          element: node,
          moduleContainer:
            moduleContainer instanceof HTMLElement ? moduleContainer : null,
          moduleType,
          innerHTML: node.innerHTML,
          textContent
        });
      });

    return editors;
  }

  function inferModuleTypeFromContainer(
    container: HTMLElement | null
  ): string {
    if (container === null) {
      return "unknown";
    }

    const label = runtime
      .normalizeMultilineText(
        [
          container.getAttribute("aria-label") ?? "",
          container.getAttribute("data-name") ?? "",
          container.className,
          container.querySelector(
            ".StageColumn_moduleLabel__u4zmN, .module-name-label--cs"
          )?.textContent ?? ""
        ].join(" ")
      )
      .toLowerCase();

    if (label.includes("title") || label.includes("heading")) {
      return "title";
    }

    if (label.includes("paragraph") || label.includes("text")) {
      return "paragraph";
    }

    if (label.includes("button")) {
      return "button";
    }

    if (label.includes("spacer")) {
      return "spacer";
    }

    if (label.includes("image")) {
      return "image";
    }

    if (label.includes("divider")) {
      return "divider";
    }

    if (label.includes("social")) {
      return "social";
    }

    if (label.includes("menu") || label.includes("nav")) {
      return "menu";
    }

    if (label.includes("html") || label.includes("code")) {
      return "html_block";
    }

    return "unknown";
  }

  function isNonTranslatableModuleType(moduleType: string): boolean {
    return (
      moduleType === "spacer" ||
      moduleType === "image" ||
      moduleType === "divider" ||
      moduleType === "social" ||
      moduleType === "menu"
    );
  }

  function isTranslatableModuleContent(textContent: string): boolean {
    const trimmed = textContent.trim();

    if (trimmed.length === 0) {
      return false;
    }

    return /[\p{L}\p{N}]/u.test(trimmed);
  }

  function applyTranslationEntriesToModuleEditors(
    editors: readonly BrazeModuleEditor[],
    translationEntries: readonly {
      readonly entryId: string;
      readonly sourceText: string;
    }[]
  ): BrazeModuleWriteResult[] {
    const results: BrazeModuleWriteResult[] = [];
    const appliedEntryIds = new Set<string>();

    for (const editor of editors) {
      const matchingEntries: { entryId: string; sourceText: string }[] = [];

      for (const entry of translationEntries) {
        if (appliedEntryIds.has(entry.entryId)) {
          continue;
        }

        if (editor.innerHTML.includes(entry.sourceText)) {
          matchingEntries.push(entry);
        }
      }

      if (matchingEntries.length === 0) {
        continue;
      }

      let updatedHtml = editor.innerHTML;
      const applied: string[] = [];

      for (const entry of matchingEntries) {
        const tagged = `{% translation ${entry.entryId} %}${entry.sourceText}{% endtranslation %}`;
        const nextHtml = updatedHtml.replace(entry.sourceText, tagged);

        if (nextHtml !== updatedHtml) {
          updatedHtml = nextHtml;
          applied.push(entry.entryId);
          appliedEntryIds.add(entry.entryId);
        }
      }

      if (applied.length > 0) {
        writeToModuleEditor(editor.element, updatedHtml);
        results.push({
          element: editor.element,
          moduleType: editor.moduleType,
          entriesApplied: applied
        });
      }
    }

    return results;
  }

  function writeToModuleEditor(
    element: HTMLElement,
    html: string
  ): void {
    element.focus();
    element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    element.innerHTML = html;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" })
    );
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function verifyModuleEditorWrites(
    writeResults: readonly BrazeModuleWriteResult[]
  ): readonly AdapterNote[] {
    const notes: AdapterNote[] = [];
    let totalVerified = 0;
    let totalFailed = 0;

    for (const result of writeResults) {
      const currentHtml = result.element.innerHTML;

      for (const entryId of result.entriesApplied) {
        if (currentHtml.includes(`{% translation ${entryId} %}`)) {
          totalVerified += 1;
        } else {
          totalFailed += 1;
          notes.push({
            code: "writeback_tag_not_found",
            severity: "warning",
            message: `Tag ${entryId} was not found in the ${result.moduleType} editor after write. The editor may have rejected the change.`
          });
        }
      }
    }

    if (totalVerified > 0 && totalFailed === 0) {
      notes.push({
        code: "writeback_verified",
        severity: "info",
        message: `Verified ${totalVerified} translation tag(s) persisted in module editor DOM.`
      });
    }

    if (totalFailed > 0) {
      notes.push({
        code: "writeback_verification_partial",
        severity: "warning",
        message: `${totalFailed} of ${totalVerified + totalFailed} translation tag(s) could not be verified in the editor DOM after write.`
      });
    }

    return notes;
  }

  function extractIdHint(
    url: URL,
    pathSegments: readonly string[],
    queryKeys: readonly string[]
  ): string | undefined {
    const queryHint = extractQueryHint(url, queryKeys);

    if (queryHint !== undefined) {
      return queryHint;
    }

    const segments = url.pathname
      .split("/")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    for (const pathSegment of pathSegments) {
      const segmentIndex = segments.indexOf(pathSegment);

      if (segmentIndex !== -1) {
        const nextSegment = segments[segmentIndex + 1];

        if (nextSegment !== undefined) {
          return nextSegment;
        }
      }
    }

    return undefined;
  }

  function extractQueryHint(
    url: URL,
    queryKeys: readonly string[]
  ): string | undefined {
    for (const queryKey of queryKeys) {
      const queryValue = url.searchParams.get(queryKey);

      if (queryValue !== null && queryValue.trim().length > 0) {
        return queryValue.trim();
      }
    }

    return undefined;
  }
})();
