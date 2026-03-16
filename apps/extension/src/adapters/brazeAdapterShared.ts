function getBrazeAdapterShared(): BrazeAdapterSharedApi {
  const sharedHost = globalThis as typeof globalThis & {
    __brazeAiBrazeAdapterShared?: BrazeAdapterSharedApi;
  };
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const structuralHtmlPattern =
    /<(p|div|a|br|strong|em|ul|ol|li|table|tr|td|th|tbody|thead|tfoot|h[1-6])(\s|>)/i;
  const tinyMcePlaceholderPattern =
    /^\s*<span\b[^>]*class=(['"])[^'"]*tinyMce-placeholder[^'"]*\1[^>]*>([\s\S]*?)<\/span>\s*$/i;
  const bodyPattern = /<body\b[^>]*>([\s\S]*?)<\/body>/i;

  if (sharedHost.__brazeAiBrazeAdapterShared !== undefined) {
    return sharedHost.__brazeAiBrazeAdapterShared;
  }

  function normalizeWhitespace(value: string): string {
    return value
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n");
  }

  const api: BrazeAdapterSharedApi = {
    validateTransformForApply(transformResult): BrazeApplyGuardResult {
      if (transformResult.transformStatus !== "success") {
        return {
          canApply: false,
          message: "The backend transform did not succeed, so nothing was written back."
        };
      }

      if (transformResult.transformedContent === null) {
        return {
          canApply: false,
          message:
            "The backend returned no transformed content, so nothing was written back."
        };
      }

      const blockingValidationError = transformResult.validationErrors.find(
        (validationError) => validationError.severity === "error"
      );

      if (blockingValidationError !== undefined) {
        return {
          canApply: false,
          message: `Write-back was blocked by transform validation: ${blockingValidationError.message}`
        };
      }

      return {
        canApply: true,
        message: "The transform result is safe to apply."
      };
    },
    resolveWritePlan(input): BrazeWritePlan | null {
      if (
        input.tagName === "textarea" ||
        input.tagName === "input" ||
        input.editorType === "code_editor"
      ) {
        return {
          mode: "value",
          description: "form control value"
        };
      }

      if (input.isContentEditable) {
        return {
          mode:
            input.contentFieldType === "html" ? "innerHTML" : "textContent",
          description:
            input.contentFieldType === "html"
              ? "editable HTML content"
              : "editable text content"
        };
      }

      if (input.tagName === "div" || input.tagName === "section" || input.tagName === "span") {
        return {
          mode:
            input.contentFieldType === "html" ? "innerHTML" : "textContent",
          description:
            input.contentFieldType === "html" ? "HTML container" : "text container"
        };
      }

      return null;
    },
    selectCandidateIndex(candidates): BrazeCandidateSelectionResult {
      if (candidates.length === 0) {
        return {
          selectedIndex: null,
          reason: "none"
        };
      }

      const focusedIndexes = candidates.reduce<number[]>(
        (indexes, candidate, index) => {
          if (candidate.isFocused) {
            indexes.push(index);
          }

          return indexes;
        },
        []
      );

      if (focusedIndexes.length === 1) {
        return {
          selectedIndex: focusedIndexes[0] ?? null,
          reason: "focused"
        };
      }

      const [topCandidate, secondCandidate] = candidates;

      if (topCandidate === undefined) {
        return {
          selectedIndex: null,
          reason: "none"
        };
      }

      if (
        secondCandidate !== undefined &&
        topCandidate.score - secondCandidate.score <= 8 &&
        topCandidate.contentFieldKey !== secondCandidate.contentFieldKey &&
        topCandidate.text !== secondCandidate.text
      ) {
        return {
          selectedIndex: null,
          reason: "ambiguous"
        };
      }

      return {
        selectedIndex: 0,
        reason: "highest_score"
      };
    },
    shouldDiscardCandidateText(text): boolean {
      const normalizedText = text.trim();

      if (normalizedText.length === 0) {
        return true;
      }

      if (
        normalizedText.includes("{% translation") ||
        normalizedText.includes("{% endtranslation %}")
      ) {
        return true;
      }

      if (uuidPattern.test(normalizedText)) {
        return true;
      }

      return /^\{?[$]?[{(]?[A-Za-z0-9_.:-]{24,}[})]?\}?$/.test(normalizedText);
    },
    shouldSkipInputCandidate(input): boolean {
      if (input.tagName !== "input") {
        return false;
      }

      if (
        input.signalText.includes("subject") ||
        input.signalText.includes("preheader")
      ) {
        return false;
      }

      return input.isBeeStagePage;
    },
    normalizeEditableContent(input): BrazeEditableContentResult {
      const normalizedText = normalizeWhitespace(input.text);
      let rawContent = input.html.trim();
      const placeholderMatch = rawContent.match(tinyMcePlaceholderPattern);

      if (placeholderMatch?.[2] !== undefined) {
        rawContent = placeholderMatch[2].trim();
      }

      if (rawContent.length === 0) {
        rawContent = normalizedText;
      }

      const contentFieldType =
        structuralHtmlPattern.test(rawContent) ? "html" : input.contentFieldType;

      return {
        rawContent: contentFieldType === "html" ? rawContent : normalizedText,
        previewText: normalizedText,
        contentFieldType
      };
    },
    extractPreviewDocumentContent(documentHtml): BrazePreviewDocumentResult {
      const normalizedDocumentHtml = documentHtml.trim();
      const bodyMatch = normalizedDocumentHtml.match(bodyPattern);
      const rawContent =
        bodyMatch?.[1]?.trim().length
          ? bodyMatch[1].trim()
          : normalizedDocumentHtml;
      const previewText = normalizeWhitespace(
        rawContent
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<!--[\s\S]*?-->/g, " ")
          .replace(/<[^>]+>/g, " ")
      );

      return {
        documentHtml: normalizedDocumentHtml,
        rawContent,
        previewText
      };
    },
    injectPreviewDocumentContent(documentHtml, bodyHtml): string {
      if (bodyPattern.test(documentHtml)) {
        return documentHtml.replace(bodyPattern, (fullMatch) => {
          const openTagMatch = fullMatch.match(/^<body\b[^>]*>/i);
          const closeTagMatch = fullMatch.match(/<\/body>$/i);
          const openTag = openTagMatch?.[0] ?? "<body>";
          const closeTag = closeTagMatch?.[0] ?? "</body>";

          return `${openTag}${bodyHtml}${closeTag}`;
        });
      }

      return bodyHtml;
    }
  };

  sharedHost.__brazeAiBrazeAdapterShared = api;

  return api;
}
