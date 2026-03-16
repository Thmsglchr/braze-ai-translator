import { describe, expect, it } from "vitest";

import {
  TRANSLATION_CSV_COLUMNS,
  createTranslationCsvRows,
  escapeCsvCell,
  parseTranslationCsv,
  stringifyTranslationCsv,
  type ExtractedTranslationEntry,
  type TranslationCsvRow
} from "./index.js";

const sampleEntries: readonly ExtractedTranslationEntry[] = [
  {
    key: "translation_1",
    source: "Welcome to Braze"
  },
  {
    key: "translation_2",
    source: "Track your order"
  }
];

describe("csv-utils", () => {
  it("creates stable CSV rows from extracted entries and explicit locales", () => {
    const rows = createTranslationCsvRows(sampleEntries, {
      sourceLocale: "en-US",
      targetLocales: ["fr-FR", "de-DE"]
    });

    expect(rows).toEqual([
      {
        translation_id: "translation_1",
        source_locale: "en-US",
        source_text: "Welcome to Braze",
        target_locale: "fr-FR",
        translated_text: "",
        status: "pending"
      },
      {
        translation_id: "translation_1",
        source_locale: "en-US",
        source_text: "Welcome to Braze",
        target_locale: "de-DE",
        translated_text: "",
        status: "pending"
      },
      {
        translation_id: "translation_2",
        source_locale: "en-US",
        source_text: "Track your order",
        target_locale: "fr-FR",
        translated_text: "",
        status: "pending"
      },
      {
        translation_id: "translation_2",
        source_locale: "en-US",
        source_text: "Track your order",
        target_locale: "de-DE",
        translated_text: "",
        status: "pending"
      }
    ]);
  });

  it("stringifies rows using the stable header order", () => {
    const row: TranslationCsvRow = {
      translation_id: "translation_3",
      source_locale: "en-US",
      source_text: "Hello, \"friend\"\nLine two",
      target_locale: "fr-FR",
      translated_text: "",
      status: "needs_review"
    };

    const csv = stringifyTranslationCsv([row]);

    expect(csv).toBe(
      `${TRANSLATION_CSV_COLUMNS.join(",")}\ntranslation_3,en-US,"Hello, ""friend""\nLine two",fr-FR,,needs_review\n`
    );
  });

  it("round-trips UTF-8-safe rows through CSV serialization and parsing", () => {
    const rows: readonly TranslationCsvRow[] = [
      {
        translation_id: "translation_4",
        source_locale: "en-US",
        source_text: "Caf\u00e9 \u2615",
        target_locale: "ja-JP",
        translated_text: "\u3053\u3093\u306b\u3061\u306f",
        status: "translated"
      }
    ];

    const csv = stringifyTranslationCsv(rows);
    const parsedRows = parseTranslationCsv(csv);

    expect(parsedRows).toEqual(rows);
  });

  it("parses CSV content with a UTF-8 BOM at the start of the header", () => {
    const parsedRows = parseTranslationCsv(
      `\uFEFF${TRANSLATION_CSV_COLUMNS.join(",")}\ntranslation_5,en-US,Hello,es-ES,Hola,translated\n`
    );

    expect(parsedRows).toEqual([
      {
        translation_id: "translation_5",
        source_locale: "en-US",
        source_text: "Hello",
        target_locale: "es-ES",
        translated_text: "Hola",
        status: "translated"
      }
    ]);
  });

  it("rejects CSV files whose header order does not match the contract", () => {
    expect(() =>
      parseTranslationCsv(
        "source_locale,translation_id,source_text,target_locale,translated_text,status\n"
      )
    ).toThrow(
      'Invalid translation CSV header at column 1: expected "translation_id", received "source_locale".'
    );
  });

  it("escapes carriage returns in cells that need quoting", () => {
    expect(escapeCsvCell("line 1\rline 2")).toBe('"line 1\rline 2"');
  });
});
