# Decisions

## 2026-03-15: MVP transform output should use Braze translation blocks

### Status

Accepted. This supersedes the earlier content-block decision.

### Context

The product intent is to prepare Braze editor content for localization by
wrapping translatable copy in Braze translation tags while preserving existing
Liquid exactly.

The previous implementation was wrong in two important ways:

- it emitted deterministic content block references instead of translation tags
- it split sentence-level spans at `{% ... %}` boundaries, which broke control
  flow copy such as `Your order {% if ... %}...{% endif %}.`

### Decision

The Liquid engine must emit readable Braze translation blocks:

- `{% translation item_n %}...{% endtranslation %}`

The engine should wrap the full safe translatable span, not replace it with an
opaque content-block indirection token.

### Rationale

- This matches the intended Braze-localization authoring flow.
- The transformed content stays diffable because the original source remains
  inside each translation block.
- Readable incremental IDs are easier to inspect directly in the Braze editor
  during the POC.
- Existing Liquid is preserved exactly because the engine wraps raw source
  spans instead of rewriting the Liquid internals.
- The OpenAI translation provider already protects `{{ ... }}` and `{% ... %}`
  placeholders, so the backend can safely translate extracted entries without
  changing the structural transform step.

### Consequences

- `/transform` now returns translation-block output rather than content-block
  references.
- `translationEntries` are assigned `item_1`, `item_2`, ... in document order
  for each transformed field.
- Liquid control-flow tags such as `{% if %}` and `{% endif %}` may remain
  inside a single extracted translation span when they are part of the same
  sentence.
- Existing translation tags are treated as unsupported transform input for the
  MVP, to avoid accidental double-wrapping.

### Minimum remaining limits

- HTML parsing remains intentionally shallow.
- Only a conservative subset of Liquid control-flow tags is kept inside a
  translation span.
- Braze sync contracts are still mock-oriented and do not yet implement real
  translation-tag-aware writeback.
