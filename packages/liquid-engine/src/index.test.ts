import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { inspectLiquidTemplate, tagLiquidTemplate } from "./index.js";

function readFixture(fileName: string): string {
  return readFileSync(
    resolve(process.cwd(), "tests/fixtures/liquid-engine", fileName),
    "utf8"
  ).replace(/\r?\n$/, "");
}

describe("tagLiquidTemplate", () => {
  it("wraps plain text content in a deterministic Braze content block tag", () => {
    const fixture = readFixture("plain-text.txt");
    const firstResult = tagLiquidTemplate(fixture);
    const secondResult = tagLiquidTemplate(fixture);

    expect(firstResult.validationErrors).toEqual([]);
    expect(firstResult.translationEntries).toHaveLength(1);
    expect(firstResult.translationEntries[0]?.sourceText).toBe("Welcome aboard.");
    expect(firstResult.translationEntries[0]?.preservedLiquidBlocks).toEqual([]);
    expect(firstResult.transformedContent).toMatch(
      /^\{\{content_blocks\.\$\{tr_[a-f0-9]{16}\}\}\}$/
    );
    expect(secondResult.transformedContent).toBe(firstResult.transformedContent);
    expect(secondResult.translationEntries[0]?.entryId).toBe(
      firstResult.translationEntries[0]?.entryId
    );
  });

  it("preserves inline Liquid variables exactly inside extracted entries", () => {
    const fixture = readFixture("inline-liquid.liquid");
    const result = tagLiquidTemplate({
      rawContent: fixture,
      sourceLocale: "en-US",
      messageChannel: "email",
      contentFieldKey: "email.body_html"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries).toHaveLength(1);
    expect(result.translationEntries[0]?.sourceText).toBe(fixture);
    expect(result.translationEntries[0]?.preservedLiquidBlocks).toEqual([
      "{{ first_name | default: 'friend' }}"
    ]);
    expect(result.transformedContent).toMatch(
      /^\{\{content_blocks\.\$\{tr_[a-f0-9]{16}\}\}\}$/
    );
  });

  it("creates distinct deterministic ids for repeated strings in separate spans", () => {
    const fixture = readFixture("repeated-strings.txt");
    const result = tagLiquidTemplate({
      rawContent: fixture,
      sourceLocale: "en-US",
      messageChannel: "email",
      contentFieldKey: "email.body_text",
      contentFieldType: "plain_text"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries).toHaveLength(2);
    expect(result.translationEntries[0]?.sourceText).toBe("Sale now on.");
    expect(result.translationEntries[1]?.sourceText).toBe("Sale now on.");
    expect(result.translationEntries[0]?.entryId).not.toBe(
      result.translationEntries[1]?.entryId
    );
    expect(result.transformedContent).toMatch(
      /^\{\{content_blocks\.\$\{tr_[a-f0-9]{16}\}\}\}\n\{\{content_blocks\.\$\{tr_[a-f0-9]{16}\}\}\}$/
    );
  });

  it("fails closed for malformed Liquid input", () => {
    const fixture = readFixture("malformed-liquid.liquid");
    const result = tagLiquidTemplate(fixture);

    expect(result.transformedContent).toBeNull();
    expect(result.translationEntries).toEqual([]);
    expect(result.validationErrors).toHaveLength(1);
    expect(result.validationErrors[0]?.errorCode).toBe("invalid_liquid_syntax");
    expect(result.transformResult.transformStatus).toBe("failed");
  });

  it("wraps only HTML text nodes and leaves URL-only text untouched", () => {
    const fixture = readFixture("simple-html.html");
    const result = tagLiquidTemplate({
      rawContent: fixture,
      sourceLocale: "en-US",
      messageChannel: "email",
      contentFieldKey: "email.body_html",
      contentFieldType: "html"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries).toHaveLength(2);
    expect(result.translationEntries.map((entry) => entry.sourceText)).toEqual([
      "Hello ",
      "world"
    ]);
    expect(result.transformedContent).toMatch(
      /^<div><p>\{\{content_blocks\.\$\{tr_[a-f0-9]{16}\}\}\}<strong>\{\{content_blocks\.\$\{tr_[a-f0-9]{16}\}\}\}<\/strong><\/p><p><a href="https:\/\/example\.com">https:\/\/example\.com<\/a><\/p><\/div>$/
    );
  });
});

describe("inspectLiquidTemplate", () => {
  it("reports translatable segments without mutating the original content", () => {
    const fixture = readFixture("inline-liquid.liquid");
    const result = inspectLiquidTemplate(fixture);

    expect(result.original).toBe(fixture);
    expect(result.translatableSegments).toEqual([fixture]);
    expect(result.validationErrors).toEqual([]);
    expect(result.detectedLiquid).toBe(true);
  });
});
