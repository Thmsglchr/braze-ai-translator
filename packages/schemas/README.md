# Schemas

Shared runtime contracts for the Braze localization assistant.

## Scope

This package defines the payloads that move through the POC extension ->
backend -> translation -> Braze pipeline:

- editor-preparation payloads captured from Braze-originated content
- translation entries produced by the Liquid engine
- transform results for auditable tag insertion
- template-translation route and workflow contracts
- Braze template source and push contracts
- low-level translation request and response contracts used by the server
- CSV export and import contracts owned by the server
- mock Braze sync request and response contracts
- structured validation errors and API error responses

## Design Rules

- every contract exports both a `zod` runtime schema and an inferred
  TypeScript type
- identifiers, locale codes, and text ranges are validated explicitly
- extraction and translation contracts fail closed on duplicate IDs,
  duplicate target locales, or mismatched parent IDs
- transform results keep both original and transformed content so changes
  stay diffable
- template-translation summaries explicitly account for completed, skipped,
  and failed work

## Workflow Boundaries

The shared contracts are split across the two POC workflows:

1. Editor preparation
   - `ExtractedContentPayloadSchema`
   - `TranslationEntrySchema`
   - `TransformResultSchema`
2. Template ID translation
   - `TemplateTranslateRequestSchema`
   - `TemplateTranslateResponseSchema`
   - `TemplateTranslationRequestSchema`
   - `TemplateTranslationResultSchema`
   - `TranslationSummarySchema`
   - `BrazeTemplateSourceDataSchema`
   - `BrazeTemplatePushRequestSchema`
   - `BrazeTemplatePushResultSchema`

The lower-level `TranslationRequestSchema`, `TranslationResponseSchema`,
`Csv*`, and `BrazeSync*` contracts remain server-side building blocks for the
template translation workflow.

## Main Exports

- `ExtractedContentPayloadSchema`
- `TranslationEntrySchema`
- `TransformResultSchema`
- `ValidationErrorSchema`
- `TemplateTranslateRequestSchema`
- `TemplateTranslateResponseSchema`
- `TranslationSummarySchema`
- `TemplateTranslationRequestSchema`
- `TemplateTranslationResultSchema`
- `BrazeTemplateSourceDataSchema`
- `BrazeTemplatePushRequestSchema`
- `BrazeTemplatePushResultSchema`
- `TranslationRequestSchema`
- `TranslationResponseSchema`
- `TranslationCsvRowSchema`
- `CsvExportRequestSchema`
- `CsvExportResponseSchema`
- `CsvImportRequestSchema`
- `CsvImportResponseSchema`
- `BrazeSyncRequestSchema`
- `BrazeSyncResultSchema`
- `ApiErrorResponseSchema`

Import from `@braze-ai-translator/schemas` once the package is consumed by
the other workspaces.
