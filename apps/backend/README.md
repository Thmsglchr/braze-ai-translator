# Backend MVP

Minimal Fastify backend for exercising the local localization pipeline.
The transform and Braze sync steps stay local-only, while the primary
translation route now calls OpenAI through a backend provider.

## Endpoints

- `POST /transform`
  - request: `ExtractedContentPayload`
  - response: `TransformResult`
- `POST /translate`
  - request: `TranslationRequest`
  - response: `TranslationResponse`
- `POST /translate/mock`
  - request: `TranslationRequest`
  - response: `TranslationResponse`
- `POST /braze/mock-sync`
  - request: `BrazeSyncRequest`
  - response: `BrazeSyncResult`

## Design

- request and response payloads are validated with the shared `zod` schemas
- route handlers stay thin and delegate behavior to provider interfaces
- the default translation provider lives in `src/providers/openaiTranslator.ts`
- the mock translation provider remains available for tests and local smoke runs
- tests use `fastify.inject()` to exercise the HTTP layer in-process

## Translation Pipeline

`POST /translate` accepts `translationEntries` from the Liquid engine and
translates only each entry's `sourceText`.

Before an entry is sent to OpenAI, the backend replaces protected syntax with
temporary tokens:

- Liquid output blocks such as `{{ first_name }}`
- Liquid tags such as `{% if vip %}`
- Handlebars-style placeholders such as `{{name}}` and `{{{name}}}`

The provider then:

1. sends the protected text to OpenAI
2. receives translated text
3. verifies every protected token is still present exactly once
4. restores the original placeholders verbatim
5. returns validation errors instead of guessing when restoration is unsafe

This keeps placeholder preservation in the backend and leaves
`packages/liquid-engine` unchanged.

## Environment

`POST /translate` requires:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

If either variable is missing, the OpenAI translation route fails with a
backend error. `POST /translate/mock` remains available when you need a
deterministic local-only path.
