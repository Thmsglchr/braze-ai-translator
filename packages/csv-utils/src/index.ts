export const TRANSLATION_CSV_COLUMNS = [
  "translation_id",
  "source_locale",
  "source_text",
  "target_locale",
  "translated_text",
  "status"
] as const;

export type TranslationCsvColumn = (typeof TRANSLATION_CSV_COLUMNS)[number];

export interface ExtractedTranslationEntry {
  readonly key: string;
  readonly source: string;
}

export interface TranslationCsvRow {
  readonly translation_id: string;
  readonly source_locale: string;
  readonly source_text: string;
  readonly target_locale: string;
  readonly translated_text: string;
  readonly status: string;
}

export interface CreateTranslationCsvRowsOptions {
  readonly sourceLocale: string;
  readonly targetLocales: readonly string[];
  readonly status?: string;
}

const DEFAULT_TRANSLATION_STATUS = "pending";

export function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Builds a stable row-per-locale CSV view from extracted translation entries.
 * Entry order is preserved first, then target locale order for each entry.
 */
export function createTranslationCsvRows(
  entries: readonly ExtractedTranslationEntry[],
  options: CreateTranslationCsvRowsOptions
): readonly TranslationCsvRow[] {
  const rows: TranslationCsvRow[] = [];
  const status = options.status ?? DEFAULT_TRANSLATION_STATUS;

  for (const entry of entries) {
    for (const targetLocale of options.targetLocales) {
      rows.push({
        translation_id: entry.key,
        source_locale: options.sourceLocale,
        source_text: entry.source,
        target_locale: targetLocale,
        translated_text: "",
        status
      });
    }
  }

  return rows;
}

export function stringifyTranslationCsv(
  rows: readonly TranslationCsvRow[]
): string {
  const header = TRANSLATION_CSV_COLUMNS.join(",");
  const dataLines = rows.map((row) =>
    TRANSLATION_CSV_COLUMNS.map((column) => escapeCsvCell(row[column])).join(",")
  );

  return [header, ...dataLines].join("\n") + "\n";
}

export function parseTranslationCsv(
  csv: string
): readonly TranslationCsvRow[] {
  const records = parseCsvRecords(csv);

  if (records.length === 0) {
    return [];
  }

  const firstRecord = records[0];

  if (firstRecord === undefined) {
    return [];
  }

  const header = [...firstRecord];
  header[0] = stripUtf8Bom(header[0] ?? "");
  assertExpectedHeader(header);

  return records.slice(1).map((record, index) =>
    createTranslationCsvRow(record, index + 2)
  );
}

function stripUtf8Bom(value: string): string {
  if (value.startsWith("\uFEFF")) {
    return value.slice(1);
  }

  return value;
}

function assertExpectedHeader(header: readonly string[]): void {
  if (header.length !== TRANSLATION_CSV_COLUMNS.length) {
    throw new Error(
      `Invalid translation CSV header width: expected ${TRANSLATION_CSV_COLUMNS.length} columns, received ${header.length}.`
    );
  }

  TRANSLATION_CSV_COLUMNS.forEach((column, index) => {
    if (header[index] !== column) {
      throw new Error(
        `Invalid translation CSV header at column ${index + 1}: expected "${column}", received "${header[index] ?? ""}".`
      );
    }
  });
}

function createTranslationCsvRow(
  record: readonly string[],
  lineNumber: number
): TranslationCsvRow {
  if (record.length !== TRANSLATION_CSV_COLUMNS.length) {
    throw new Error(
      `Invalid translation CSV row at line ${lineNumber}: expected ${TRANSLATION_CSV_COLUMNS.length} columns, received ${record.length}.`
    );
  }

  return {
    translation_id: record[0] ?? "",
    source_locale: record[1] ?? "",
    source_text: record[2] ?? "",
    target_locale: record[3] ?? "",
    translated_text: record[4] ?? "",
    status: record[5] ?? ""
  };
}

function parseCsvRecords(csv: string): readonly string[][] {
  if (csv.length === 0) {
    return [];
  }

  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = "";
  let insideQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (insideQuotes) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          currentField += '"';
          index += 1;
        } else {
          insideQuotes = false;
        }
      } else {
        currentField += character;
      }

      continue;
    }

    if (character === '"') {
      insideQuotes = true;
      continue;
    }

    if (character === ",") {
      currentRecord.push(currentField);
      currentField = "";
      continue;
    }

    if (character === "\n") {
      currentRecord.push(currentField);
      records.push(currentRecord);
      currentRecord = [];
      currentField = "";
      continue;
    }

    if (character === "\r") {
      if (csv[index + 1] === "\n") {
        continue;
      }

      currentRecord.push(currentField);
      records.push(currentRecord);
      currentRecord = [];
      currentField = "";
      continue;
    }

    currentField += character;
  }

  if (insideQuotes) {
    throw new Error("Invalid CSV input: unclosed quoted field.");
  }

  if (currentField.length > 0 || currentRecord.length > 0) {
    currentRecord.push(currentField);
    records.push(currentRecord);
  }

  return records;
}
