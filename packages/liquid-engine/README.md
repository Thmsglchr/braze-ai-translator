# Liquid Engine

MVP Liquid tagging engine for the Braze localization assistant.

## What It Does

Given message content, the engine:

- scans the content into structural tokens instead of regex-rewriting the
  whole string
- identifies safe translatable spans made of text plus inline Liquid that
  belongs to the same sentence
- wraps each safe span in an incremental Braze translation block of the form
  `{% translation item_n %}...{% endtranslation %}`
- returns extracted translation entries and structured validation errors
  using the shared schemas package

## MVP Scope

The current implementation supports:

- plain text
- simple HTML text nodes
- inline Liquid output blocks inside text
- common Liquid control-flow tags inside text spans, such as `{% if %}` and
  `{% endif %}`
- existing translation tags as a fail-closed unsupported input case

The current implementation intentionally does not attempt full Liquid or
full HTML parsing.

## Algorithm

1. Validate Liquid delimiters across the entire source string.
2. Infer `html` vs `plain_text` mode when the caller does not specify it.
3. Tokenize the source into:
   - text
   - HTML tags
   - Liquid output blocks `{{ ... }}`
   - Liquid tag blocks `{% ... %}`
4. Build candidate translation spans from contiguous text plus Liquid output
   blocks and supported control-flow Liquid tags.
5. Treat HTML tags, unsupported Liquid tags, and newlines as hard boundaries.
6. Skip spans that are blank or just a standalone URL.
7. Wrap each safe span in an incremental Braze translation block and emit
   matching `TranslationEntry` records.
8. Validate the final extracted payload and transform result with the shared
   schema package.

## Failure Modes

The engine fails closed and returns validation errors when it sees:

- empty input
- malformed or unexpectedly closed Liquid delimiters
- unclosed HTML tags in `html` mode
- unsupported HTML tags such as `<script>` or `<style>`
- existing `{% translation ... %}` tags in the source input

## Known Limitations

- HTML parsing is intentionally shallow and only targets simple text nodes.
- The MVP does not parse nested Liquid syntax beyond delimiter safety.
- The engine only keeps a conservative subset of Liquid control-flow tags
  inside translation spans. Other Liquid tags still act as hard boundaries.
