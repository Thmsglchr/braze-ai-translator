# Braze AI Translator POC

POC monorepo for a Braze localization assistant with a thin browser extension,
an AI translation server, shared schemas, and deterministic Liquid-safe
transforms.

## POC Workflows

### 1. Prepare Template For Localization

Braze editor content is captured by the browser extension, sent to the server
as `ExtractedContentPayload`, transformed into localization-ready Liquid, and
returned as `TransformResult`.

In the current extension MVP, supported Braze editor surfaces can apply the
returned transformed content back into the editor through the guarded
`Transform & Apply` path.

### 2. Translate Missing Locales

A server-side template translation run starts from
`TemplateTranslateRequest`, uses a Braze template ID plus target locales,
retrieves template translation data, translates only missing values,
validates the output, and returns `TemplateTranslateResponse`.

## Workspace Map

- `apps/extension`: browser-side capture and debug overlay for the editor
  preparation flow
- `apps/backend`: AI translation server and orchestration boundary
- `packages/schemas`: shared `zod` contracts for extension/backend payloads
- `packages/liquid-engine`: deterministic Liquid tagging and extraction logic
- `packages/csv-utils`: CSV helpers used by the server-side translation flow

## Commands

- `pnpm install`
- `pnpm build`
- `pnpm test`

## Docs

- [Architecture](/Users/T.GuilcherTrouche/Documents/Dev/braze-ai-translator/docs/architecture.md)
- [Server API](/Users/T.GuilcherTrouche/Documents/Dev/braze-ai-translator/docs/server-api.md)
- [Schema package](/Users/T.GuilcherTrouche/Documents/Dev/braze-ai-translator/packages/schemas/README.md)
