# Extension MVP

Chrome extension MVP for exercising the local localization pipeline and a Braze
editor write-back POC, plus the canvas translation workflow helper.

## What It Does

- detects Braze-like editor pages conservatively and falls back to a generic page adapter
- extracts that content into the shared `ExtractedContentPayload` shape
- calls the backend `POST /transform` endpoint through the extension background
  worker
- can write transformed content back into the detected Braze editor region for
  the POC flow
- renders adapter selection, extraction details, the extracted payload,
  transform result, validation errors, and apply results in an in-page debug
  overlay

The generic fallback adapter remains read-only.

## POC Workflow Position

This app covers the editor-preparation workflow:

- capture Braze editor content
- create `ExtractedContentPayload`
- call `POST /transform`
- review and optionally apply `TransformResult` back into the editor

This app does not cover the template-ID translation workflow. Missing-locale
translation runs stay server-side behind `TemplateTranslationRequest` and
`TemplateTranslationResult`.

## Local Run

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Build the backend and extension:

   ```bash
   pnpm build
   ```

3. Start the backend server:

   ```bash
   pnpm --filter @braze-ai-translator/backend start
   ```

   The default local backend URL is `http://127.0.0.1:8787`.

4. Serve the demo page in a separate terminal:

   ```bash
   python3 -m http.server 4173 -d apps/extension/demo
   ```

5. Load the unpacked extension in Chrome from:

   [apps/extension](/Users/T.GuilcherTrouche/Documents/Dev/braze-ai-translator/apps/extension)

6. Open the generic demo page:

   [http://127.0.0.1:4173](http://127.0.0.1:4173)

7. Open the Braze-like demo page:
   [http://127.0.0.1:4173/braze-editor.html](http://127.0.0.1:4173/braze-editor.html)

8. The debug overlay should appear automatically and show:
   - selected adapter
   - whether Braze was detected
   - adapter detection and extraction JSON
   - extracted payload JSON
   - backend transform result JSON
   - validation errors, if any
   - apply result JSON after a write-back attempt

9. Use the panel buttons to:
   - rerun extraction and `POST /transform`
   - run `Transform & Apply` to write the transformed content back into the
     detected Braze editor region
   - collapse the debug sections
   - hide the panel entirely and reopen it from the small launcher button

## Notes

- The Braze adapter is conservative. If the page structure is ambiguous, the
  overlay will show the Braze detection notes and skip extraction or
  write-back rather than guessing.
- The Bee drag-and-drop editor path now prefers actual stage modules with
  TinyMCE roots and currently targets visible `Title`, `Paragraph`, and
  `Button` modules ahead of generic inputs.
- On Braze drag-and-drop email pages, the adapter now prefers the rendered
  preview iframe `srcdoc` as the canonical full-email HTML source when it is
  available.
- The extension sends the preview document's `body` HTML to `/transform` and
  then rebuilds the full preview document on apply, so email CSS and head
  markup do not trip the Liquid engine.
- For Bee/TinyMCE modules, title-like placeholder wrappers are unwrapped while
  preserving the underlying Braze personalization syntax exactly, and
  paragraph/button modules preserve their editor HTML so the backend can tag
  text nodes without flattening the markup.
- The generic adapter still works for simple HTML pages and prefers selection
  text over whole-page visible text, but it does not apply transformed content
  back into the page.
- The extension keeps all parsing and transform logic in the backend and shared
  packages.
- The transform output returned by the server is now a readable Braze
  translation block such as
  `{% translation item_1 %}...{% endtranslation %}`.
- Browser automation is not added yet. Use the generic demo page, the
  Braze-like demo fixture, and optionally a real Braze editor page for manual
  verification.
- The settings panel now stores a configurable source locale for canvas
  translation requests. Use the locale code Braze/OpenAI should treat as the
  source language, for example `en`, `en-US`, or `fr-FR`.
- The `Translate Canvas` button now distinguishes complete, partial, and failed
  backend runs instead of treating every HTTP 200 response as success.

## Manual Braze Verification

1. Open a Braze editor page or the local Braze-like demo fixture.
2. Confirm the overlay header shows `Braze detected: yes`.
3. Confirm the selected adapter is `Braze Page`.
4. If the page contains multiple editable modules, click inside the specific
   title, paragraph, or button module you want to target.
5. Click `Refresh / Transform` to let the adapter re-evaluate the focused
   module.
6. Confirm the `Adapter Detection` section shows the inferred page type and any
   ambiguity notes.
7. Click `Transform & Apply` and confirm `Transform Result` and `Apply Result`
   are populated.
8. On drag-and-drop email pages, confirm the rendered preview iframe now shows
   the transformed content from the backend.
9. On module fallback pages, confirm the detected editor field now contains
   the transformed content from the backend.
10. If the page structure is unsupported, confirm the overlay reports that the
   page is ambiguous and does not write anything back.

## Unsupported Editor Cases

- Multiple equally plausible editor regions where the adapter cannot choose a
  single safe target and none is currently focused.
- Braze pages where the channel cannot be inferred reliably.
- Editor surfaces that are not plain form controls or contenteditable/text
  containers.
- Cases where the editor content changes after extraction and before
  write-back.
- Preview iframe write-back updates the rendered drag-and-drop preview for the
  POC, but it is not yet guaranteed to persist back into Braze's underlying
  editor model.

## Troubleshooting

- If the overlay reports that the extension context was invalidated, Chrome is
  still running an old content script after the extension was reloaded or
  updated. Refresh the Braze page, then open the extension again.
