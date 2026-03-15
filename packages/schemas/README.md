# Schemas

Shared runtime contracts for the Braze localization assistant.

## Scope

This package defines the payloads that are expected to move through the
future extension -> backend -> translation -> Braze pipeline:

- extracted content payloads captured from Braze-originated content
- translation entries produced by the Liquid engine
- transform results for auditable tag insertion
- structured validation errors
- future translation request and response contracts

## Design Rules

- every contract exports both a `zod` runtime schema and an inferred
  TypeScript type
- identifiers, locale codes, and text ranges are validated explicitly
- extraction and translation contracts fail closed on duplicate IDs,
  duplicate target locales, or mismatched parent IDs
- transform results keep both original and transformed content so changes
  stay diffable

## Main Exports

- `ExtractedContentPayloadSchema`
- `TranslationEntrySchema`
- `TransformResultSchema`
- `ValidationErrorSchema`
- `TranslationRequestSchema`
- `TranslationResponseSchema`

Import from `@braze-ai-translator/schemas` once the package is consumed by
the other workspaces.
