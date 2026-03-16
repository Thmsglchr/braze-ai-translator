# CSV Utils

Helpers for turning extracted translation entries into a stable CSV format for
downstream translation workflows.

## Exports

- `TRANSLATION_CSV_COLUMNS`
- `createTranslationCsvRows()`
- `stringifyTranslationCsv()`
- `parseTranslationCsv()`
- `escapeCsvCell()`

## CSV Contract

Stable column order:

1. `translation_id`
2. `source_locale`
3. `source_text`
4. `target_locale`
5. `translated_text`
6. `status`

`createTranslationCsvRows()` preserves extracted entry order first, then target
locale order for each entry. `parseTranslationCsv()` expects the same header
order so rows can round-trip without ambiguity.
