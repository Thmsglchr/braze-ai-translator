import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Script } from "node:vm";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface SharedTestContext {
  getBrazeAdapterShared: () => BrazeAdapterSharedApi;
  globalThis: SharedTestContext;
}

function loadBrazeAdapterShared(): BrazeAdapterSharedApi {
  const sourcePath = resolve(
    process.cwd(),
    "apps/extension/src/adapters/brazeAdapterShared.ts"
  );
  const sourceCode = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceCode, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022
    }
  });
  const context = {} as SharedTestContext;

  context.globalThis = context;

  new Script(transpiled.outputText).runInNewContext(context);

  return context.getBrazeAdapterShared();
}

describe("brazeAdapterShared", () => {
  it("blocks write-back when the transform fails or contains blocking errors", () => {
    const shared = loadBrazeAdapterShared();

    expect(
      shared.validateTransformForApply({
        transformStatus: "failed",
        transformedContent: null,
        validationErrors: []
      }).canApply
    ).toBe(false);

    expect(
      shared.validateTransformForApply({
        transformStatus: "success",
        transformedContent: "updated",
        validationErrors: [
          {
            errorCode: "transform_failed",
            message: "unsafe",
            severity: "error"
          }
        ]
      }).canApply
    ).toBe(false);
  });

  it("resolves write modes for supported Braze editor surfaces", () => {
    const shared = loadBrazeAdapterShared();

    expect(
      shared.resolveWritePlan({
        tagName: "textarea",
        isContentEditable: false,
        editorType: "code_editor",
        contentFieldType: "html"
      })
    ).toEqual({
      mode: "value",
      description: "form control value"
    });

    expect(
      shared.resolveWritePlan({
        tagName: "div",
        isContentEditable: true,
        editorType: "rich_text",
        contentFieldType: "plain_text"
      })
    ).toEqual({
      mode: "textContent",
      description: "editable text content"
    });
  });

  it("prefers a single focused candidate and fails closed on unresolved ties", () => {
    const shared = loadBrazeAdapterShared();

    expect(
      shared.selectCandidateIndex([
        {
          score: 92,
          contentFieldKey: "braze.email.title",
          text: "Bonjour",
          isFocused: false
        },
        {
          score: 90,
          contentFieldKey: "braze.email.body",
          text: "Vous n'avez pas fini votre inscription ?",
          isFocused: true
        }
      ])
    ).toEqual({
      selectedIndex: 1,
      reason: "focused"
    });

    expect(
      shared.selectCandidateIndex([
        {
          score: 92,
          contentFieldKey: "braze.email.title",
          text: "Bonjour",
          isFocused: false
        },
        {
          score: 90,
          contentFieldKey: "braze.email.body",
          text: "Je m'inscris",
          isFocused: false
        }
      ])
    ).toEqual({
      selectedIndex: null,
      reason: "ambiguous"
    });
  });

  it("rejects already-tagged or machine-like candidate text", () => {
    const shared = loadBrazeAdapterShared();

    expect(
      shared.shouldDiscardCandidateText(
        "{% translation item_1 %}67a0bd14-2d89-4ea8-b0a8-9e80bf6d3beb{% endtranslation %}"
      )
    ).toBe(true);

    expect(
      shared.shouldDiscardCandidateText("67a0bd14-2d89-4ea8-b0a8-9e80bf6d3beb")
    ).toBe(true);

    expect(shared.shouldDiscardCandidateText("Bonjour {{ first_name }},")).toBe(false);
  });

  it("skips generic inputs on Bee stage pages but keeps email subject fields", () => {
    const shared = loadBrazeAdapterShared();

    expect(
      shared.shouldSkipInputCandidate({
        tagName: "input",
        signalText: "module editor body",
        isBeeStagePage: true
      })
    ).toBe(true);

    expect(
      shared.shouldSkipInputCandidate({
        tagName: "input",
        signalText: "email subject line",
        isBeeStagePage: true
      })
    ).toBe(false);

    expect(
      shared.shouldSkipInputCandidate({
        tagName: "div",
        signalText: "tinyeditor root element paragraph",
        isBeeStagePage: true
      })
    ).toBe(false);
  });

  it("unwraps Bee placeholder wrappers without rewriting Braze personalization syntax", () => {
    const shared = loadBrazeAdapterShared();

    expect(
      shared.normalizeEditableContent({
        html: '<span class="tinyMce-placeholder">Bonjour {{${first_name}}},</span>',
        text: "Bonjour {{${first_name}}},",
        contentFieldType: "title"
      })
    ).toEqual({
      rawContent: "Bonjour {{${first_name}}},",
      previewText: "Bonjour {{${first_name}}},",
      contentFieldType: "title"
    });
  });

  it("preserves structural HTML for paragraph and button editor content", () => {
    const shared = loadBrazeAdapterShared();

    expect(
      shared.normalizeEditableContent({
        html: "<p>Vous n'avez pas fini votre inscription ?</p>",
        text: "Vous n'avez pas fini votre inscription ?",
        contentFieldType: "plain_text"
      })
    ).toEqual({
      rawContent: "<p>Vous n'avez pas fini votre inscription ?</p>",
      previewText: "Vous n'avez pas fini votre inscription ?",
      contentFieldType: "html"
    });

    expect(
      shared.normalizeEditableContent({
        html: '<div class="txtTinyMce-wrapper"><p>En savoir plus</p></div>',
        text: "En savoir plus",
        contentFieldType: "plain_text"
      })
    ).toEqual({
      rawContent: '<div class="txtTinyMce-wrapper"><p>En savoir plus</p></div>',
      previewText: "En savoir plus",
      contentFieldType: "html"
    });
  });

  it("extracts only the preview body HTML from a full iframe srcdoc document", () => {
    const shared = loadBrazeAdapterShared();

    expect(
      shared.extractPreviewDocumentContent(
        "<!DOCTYPE html><html><head><style>@media(max-width:620px){.row{width:100%}}</style></head><body><table><tr><td>Bonjour {{${first_name}}}</td></tr></table></body></html>"
      )
    ).toEqual({
      documentHtml:
        "<!DOCTYPE html><html><head><style>@media(max-width:620px){.row{width:100%}}</style></head><body><table><tr><td>Bonjour {{${first_name}}}</td></tr></table></body></html>",
      rawContent: "<table><tr><td>Bonjour {{${first_name}}}</td></tr></table>",
      previewText: "Bonjour {{${first_name}}}"
    });
  });

  it("rebuilds the full preview document when transformed body HTML is applied", () => {
    const shared = loadBrazeAdapterShared();

    expect(
      shared.injectPreviewDocumentContent(
        "<html><head><title></title></head><body><p>Old</p></body></html>",
        "<p>{% translation item_1 %}New{% endtranslation %}</p>"
      )
    ).toBe(
      "<html><head><title></title></head><body><p>{% translation item_1 %}New{% endtranslation %}</p></body></html>"
    );
  });
});
