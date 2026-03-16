# AI Translation Server

This app is the server-side core of the Braze localization assistant.

It owns:

- Liquid-safe transformation
- Braze template translation orchestration
- OpenAI translation orchestration
- CSV export and import
- validation of AI and CSV output
- Braze sync orchestration, with mock sync today

It does not rely on the browser client for business logic or secrets.

## POC Workflows

### Editor Preparation

The browser extension captures Braze editor content, sends
`ExtractedContentPayload` to `POST /transform`, and receives `TransformResult`
with transformed Liquid plus extracted `TranslationEntry` records.

### Template ID Translation

`POST /template/translate` accepts `TemplateTranslateRequest`, retrieves
Braze template translation data, translates only missing locale values,
validates the output, and returns `TemplateTranslateResponse`.

The backend keeps richer internal workflow contracts for this path:

- `TemplateTranslationRequest` / `TemplateTranslationResult`
- `BrazeTemplateSourceData`
- `BrazeTemplatePushRequest` / `BrazeTemplatePushResult`

## Current Route Surface

- `POST /transform`
  - request: `ExtractedContentPayload`
  - response: `TransformResult`
- `POST /template/translate`
  - request: `TemplateTranslateRequest`
  - response: `TemplateTranslateResponse`
- `POST /translate`
  - request: `TranslationRequest`
  - response: `TranslationResponse`
- `POST /translate/mock`
  - request: `TranslationRequest`
  - response: `TranslationResponse`
- `POST /csv/export`
  - request: `CsvExportRequest`
  - response: `CsvExportResponse`
- `POST /csv/import`
  - request: `CsvImportRequest`
  - response: `CsvImportResponse`
- `POST /braze/mock-sync`
  - request: `BrazeSyncRequest`
  - response: `BrazeSyncResult`

All route payloads are validated with the shared schemas package.

## Responsibilities

The server keeps route handlers thin and delegates behavior to provider
interfaces. Today that includes:

- transform provider
- template translation provider
- translation provider
- CSV provider
- Braze sync provider
- Braze template client boundary

The OpenAI translation provider protects Liquid and placeholder syntax before
translation, restores it afterward, and fails closed when restoration is
unsafe.

The default Braze template client is a typed placeholder with explicit TODOs.
Real Braze retrieval and writeback still need to be implemented behind that
interface.

## Client Boundary

The browser client should only:

- detect supported pages
- extract raw content
- call the server routes
- render debug or review UI

The browser client must not:

- hold `OPENAI_API_KEY`
- hold Braze secrets
- rewrite Liquid
- implement CSV or Braze orchestration logic

## Shared Contracts

- editor preparation:
  - `ExtractedContentPayload`
  - `TranslationEntry`
  - `TransformResult`
- template translate route:
  - `TemplateTranslateRequest`
  - `TemplateTranslateResponse`
- template translation orchestration:
  - `TemplateTranslationRequest`
  - `TemplateTranslationResult`
  - `TranslationSummary`
- Braze template boundaries:
  - `BrazeTemplateSourceData`
  - `BrazeTemplatePushRequest`
  - `BrazeTemplatePushResult`
- server execution building blocks:
  - `TranslationRequest`
  - `TranslationResponse`
  - `CsvExportRequest` / `CsvExportResponse`
  - `CsvImportRequest` / `CsvImportResponse`
  - `BrazeSyncRequest` / `BrazeSyncResult`

## Environment

`POST /translate` requires:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

`POST /template/translate` uses the same OpenAI settings. Real Braze access
still requires a concrete `BrazeTemplateClient` implementation.

`POST /translate/mock` remains available for deterministic local-only testing.

## Local Server

Build the backend and run:

```bash
pnpm --filter @braze-ai-translator/backend start
```

The default local server address is `http://127.0.0.1:8787`.

For the full server contract, see
[docs/server-api.md](/Users/T.GuilcherTrouche/Documents/Dev/braze-ai-translator/docs/server-api.md).
