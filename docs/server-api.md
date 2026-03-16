# AI Translation Server API

## Purpose

The backend app is the AI translation server for this project. The browser
extension and the server must share payload definitions from
`@braze-ai-translator/schemas`; neither side should invent its own request or
response shapes.

## Workflow Contracts

The shared schemas are split across the two POC workflows:

### Editor Preparation

- request contract: `ExtractedContentPayloadSchema`
- response contract: `TransformResultSchema`
- caller: browser extension
- responsibility:
  - validate captured editor content
  - extract `TranslationEntry` records
  - insert deterministic localization Liquid placeholders
  - return auditable transformed output

### Template ID Translation

- route request contract: `TemplateTranslateRequestSchema`
- route response contract: `TemplateTranslateResponseSchema`
- internal workflow contracts:
  - `TemplateTranslationRequestSchema`
  - `TemplateTranslationResultSchema`
  - `BrazeTemplateSourceDataSchema`
  - `BrazeTemplatePushRequestSchema`
  - `BrazeTemplatePushResultSchema`
- caller: backend route
- responsibility:
  - start from a Braze template ID
  - retrieve template translation data from Braze
  - translate only missing locale values
  - validate translated output
  - push localized values back to Braze
  - return a structured summary plus validation errors

`TemplateTranslationRequestSchema` and `TemplateTranslationResultSchema` remain
the richer workflow data model behind the route. `TemplateTranslate*` is the
thin public API contract for the same flow.

## Current Route Surface

### `POST /transform`

- request schema: `ExtractedContentPayloadSchema`
- response schema: `TransformResultSchema`
- responsibility:
  - validate extracted browser payloads
  - run the Liquid engine
  - return transformed content, extracted translation entries, and validation
    errors

### `POST /template/translate`

- request schema: `TemplateTranslateRequestSchema`
- response schema: `TemplateTranslateResponseSchema`
- responsibility:
  - fetch Braze template source data by `templateId`
  - normalize Braze data into `TranslationEntry` records
  - detect which entry/locale pairs are still missing
  - translate only the missing pairs through the configured translation
    provider
  - merge successful translations back into the template dataset
  - push updated translations through the Braze template client boundary
  - return summary counts for new translations, skipped work, and errors

### `POST /canvas/translate`

- request schema: `CanvasTranslateRequestSchema`
- response schema: `CanvasTranslateResponseSchema`
- required headers:
  - `X-Braze-Api-Key`
  - `X-Braze-Rest-Api-Url`
- optional headers:
  - `X-OpenAI-Api-Key`
  - `X-Braze-Source-Locale`
- responsibility:
  - fetch the canvas structure and message variations from Braze
  - read source translation tags and configured locales for each step/message
  - translate source entries into each target locale
  - push translations back to Braze per step/message/locale
  - return `success`, `partial`, or `failed` at the canvas level with
    step-level errors preserved in the response

### `POST /translate`

- request schema: `TranslationRequestSchema`
- response schema: `TranslationResponseSchema`
- responsibility:
  - translate validated `TranslationEntry` records
  - protect Liquid and placeholder syntax
  - reject unsafe or invalid translations

### `POST /translate/mock`

- request schema: `TranslationRequestSchema`
- response schema: `TranslationResponseSchema`
- responsibility:
  - provide deterministic local-only translated output for tests and manual
    development

### `POST /csv/export`

- request schema: `CsvExportRequestSchema`
- response schema: `CsvExportResponseSchema`
- responsibility:
  - convert translation work into the stable server CSV contract
  - keep locale and entry identifiers aligned with the shared schema package

### `POST /csv/import`

- request schema: `CsvImportRequestSchema`
- response schema: `CsvImportResponseSchema`
- responsibility:
  - parse CSV content back into typed translated entries
  - return structured validation errors for malformed or incomplete rows

### `POST /braze/mock-sync`

- request schema: `BrazeSyncRequestSchema`
- response schema: `BrazeSyncResultSchema`
- responsibility:
  - simulate Braze writeback with mock identifiers only
  - exercise the final server-side sync boundary before real Braze API
    integration exists

## Contract Rules

- all request and response bodies must be validated with shared `zod` schemas
- route handlers must stay thin and delegate behavior to providers
- the browser extension must not hold OpenAI or Braze credentials
- existing Liquid syntax must be preserved exactly
- no raw model output may move past the server without validation

## Implementation Notes

- The editor-preparation flow is live today through `POST /transform`.
- The template-ID flow is live through `POST /template/translate`.
- The default Braze template client is still a typed placeholder. Real Braze
  API or CSV-upload integration must replace it before production use.
- The OpenAI translation provider used by `POST /translate` is also reused by
  the template-ID workflow.
