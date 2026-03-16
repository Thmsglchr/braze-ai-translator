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
  it("wraps plain text content in an incremental translation block", () => {
    const fixture = readFixture("plain-text.txt");
    const firstResult = tagLiquidTemplate(fixture);
    const secondResult = tagLiquidTemplate(fixture);

    expect(firstResult.validationErrors).toEqual([]);
    expect(firstResult.translationEntries).toHaveLength(1);
    expect(firstResult.translationEntries[0]?.entryId).toBe("item_1");
    expect(firstResult.translationEntries[0]?.sourceText).toBe("Welcome aboard.");
    expect(firstResult.translationEntries[0]?.preservedLiquidBlocks).toEqual([]);
    expect(firstResult.transformedContent).toBe(
      "{% translation item_1 %}Welcome aboard.{% endtranslation %}"
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
    expect(result.translationEntries[0]?.entryId).toBe("item_1");
    expect(result.translationEntries[0]?.sourceText).toBe(fixture);
    expect(result.translationEntries[0]?.preservedLiquidBlocks).toEqual([
      "{{ first_name | default: 'friend' }}"
    ]);
    expect(result.transformedContent).toBe(
      "{% translation item_1 %}Hello {{ first_name | default: 'friend' }}!{% endtranslation %}"
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
    expect(result.translationEntries.map((entry) => entry.entryId)).toEqual([
      "item_1",
      "item_2"
    ]);
    expect(result.translationEntries[0]?.sourceText).toBe("Sale now on.");
    expect(result.translationEntries[1]?.sourceText).toBe("Sale now on.");
    expect(result.translationEntries[0]?.entryId).not.toBe(
      result.translationEntries[1]?.entryId
    );
    expect(result.transformedContent).toBe(
      "{% translation item_1 %}Sale now on.{% endtranslation %}\n{% translation item_2 %}Sale now on.{% endtranslation %}"
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
    expect(result.translationEntries.map((entry) => entry.entryId)).toEqual([
      "item_1",
      "item_2"
    ]);
    expect(result.translationEntries.map((entry) => entry.sourceText)).toEqual([
      "Hello ",
      "world"
    ]);
    expect(result.transformedContent).toBe(
      "<div><p>{% translation item_1 %}Hello {% endtranslation %}<strong>{% translation item_2 %}world{% endtranslation %}</strong></p><p><a href=\"https://example.com\">https://example.com</a></p></div>"
    );
  });

  it("keeps control-flow Liquid inside a single translation block", () => {
    const fixture = readFixture("html-control-liquid.html");
    const result = tagLiquidTemplate({
      rawContent: fixture,
      sourceLocale: "en-US",
      messageChannel: "email",
      contentFieldKey: "email.body_html",
      contentFieldType: "html"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries).toHaveLength(3);
    expect(result.translationEntries.map((entry) => entry.entryId)).toEqual([
      "item_1",
      "item_2",
      "item_3"
    ]);
    expect(result.translationEntries.map((entry) => entry.sourceText)).toEqual([
      "Hello {{ first_name }},",
      'Your order {% if loyalty_tier == "gold" %}qualifies for free express shipping{% endif %}.',
      "Track your order"
    ]);
    expect(result.translationEntries[1]?.preservedLiquidBlocks).toEqual([
      '{% if loyalty_tier == "gold" %}',
      "{% endif %}"
    ]);
    expect(result.transformedContent).toBe(
      `<div>
  <p>{% translation item_1 %}Hello {{ first_name }},{% endtranslation %}</p>
  <p>{% translation item_2 %}Your order {% if loyalty_tier == "gold" %}qualifies for free express shipping{% endif %}.{% endtranslation %}</p>
  <p><a href="https://example.com/orders/{{ order_id }}">{% translation item_3 %}Track your order{% endtranslation %}</a></p>
</div>`
    );
  });

  it("filters out HTML whitespace entities from spacer blocks", () => {
    const result = tagLiquidTemplate({
      rawContent: "<td>&#8202;</td>",
      sourceLocale: "en-US",
      messageChannel: "email",
      contentFieldKey: "email.body_html",
      contentFieldType: "html"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries).toHaveLength(0);
    expect(result.transformedContent).toBe("<td>&#8202;</td>");
  });

  it("filters out hex-encoded HTML whitespace entities", () => {
    const result = tagLiquidTemplate({
      rawContent: "<td>&#x200A;</td>",
      sourceLocale: "en-US",
      messageChannel: "email",
      contentFieldKey: "email.body_html",
      contentFieldType: "html"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries).toHaveLength(0);
    expect(result.transformedContent).toBe("<td>&#x200A;</td>");
  });

  it("keeps text that mixes HTML entities with real letters", () => {
    const result = tagLiquidTemplate({
      rawContent: "<td>&#8202;Hello&#8202;</td>",
      sourceLocale: "en-US",
      messageChannel: "email",
      contentFieldKey: "email.body_html",
      contentFieldType: "html"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries).toHaveLength(1);
    expect(result.translationEntries[0]?.sourceText).toBe("&#8202;Hello&#8202;");
  });

  it("filters out &#8202; in spacer divs from real Braze email HTML", () => {
    const spacerHtml =
      '<div class="spacer_block block-1" style="height:60px;line-height:60px;font-size:1px">&#8202;</div>';
    const result = tagLiquidTemplate({
      rawContent: spacerHtml,
      sourceLocale: "en",
      messageChannel: "email",
      contentFieldKey: "braze.email.body",
      contentFieldType: "html"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries).toHaveLength(0);
    expect(result.transformedContent).toBe(spacerHtml);
  });

  it("tags real text but skips spacer blocks in a multi-block email", () => {
    const html = [
      '<h1><span>Bonjour {{${first_name}}},</span></h1>',
      '<p style="margin:0">Vous n\'avez pas fini votre inscription ?</p>',
      '<div class="spacer_block" style="height:60px;line-height:60px;font-size:1px">&#8202;</div>'
    ].join("");

    const result = tagLiquidTemplate({
      rawContent: html,
      sourceLocale: "en",
      messageChannel: "email",
      contentFieldKey: "braze.email.body",
      contentFieldType: "html"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries).toHaveLength(2);
    expect(result.translationEntries[0]?.sourceText).toBe(
      "Bonjour {{${first_name}}},"
    );
    expect(result.translationEntries[1]?.sourceText).toBe(
      "Vous n'avez pas fini votre inscription ?"
    );
    expect(result.transformedContent).toContain("&#8202;</div>");
    expect(result.transformedContent).not.toContain(
      "{% translation item_3 %}"
    );
  });

  it("handles a real Braze API email body with <!DOCTYPE>, <style>, MSO comments", () => {
    const body = readFixture("braze-api-email-body.html");
    const result = tagLiquidTemplate({
      rawContent: body,
      sourceLocale: "en",
      messageChannel: "email",
      contentFieldKey: "email.body_html",
      contentFieldType: "html"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries.length).toBeGreaterThanOrEqual(2);

    const sourceTexts = result.translationEntries.map((e) => e.sourceText);

    expect(sourceTexts).toContainEqual(
      expect.stringContaining("Bonjour")
    );
    expect(sourceTexts).toContainEqual(
      expect.stringContaining("Vous n'avez pas fini votre inscription")
    );
    expect(sourceTexts).toContainEqual(
      expect.stringContaining("Je m'inscris")
    );

    const spacerEntries = result.translationEntries.filter(
      (e) => e.sourceText.trim() === "&#8202;"
    );
    expect(spacerEntries).toHaveLength(0);

    expect(result.transformedContent).toContain("<style>");
    expect(result.transformedContent).toContain("</style>");
    expect(result.transformedContent).toContain("{% translation item_1 %}");
  });

  it("handles a full HTML document with <style> in <head> correctly", () => {
    const html = [
      "<!DOCTYPE html><html><head>",
      "<style>*{box-sizing:border-box}body{margin:0}</style>",
      "</head><body>",
      '<h1>Bonjour {{${first_name}}},</h1>',
      "<p>Profitez d'un mois gratuit !</p>",
      '<div class="spacer_block" style="height:60px;font-size:1px">&#8202;</div>',
      "</body></html>"
    ].join("");

    const result = tagLiquidTemplate({
      rawContent: html,
      sourceLocale: "en",
      messageChannel: "email",
      contentFieldKey: "email.body_html",
      contentFieldType: "html"
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.translationEntries).toHaveLength(2);
    expect(result.translationEntries[0]?.sourceText).toBe(
      "Bonjour {{${first_name}}},"
    );
    expect(result.translationEntries[1]?.sourceText).toBe(
      "Profitez d'un mois gratuit !"
    );
    expect(result.transformedContent).toContain("{% translation item_1 %}");
    expect(result.transformedContent).toContain("{% translation item_2 %}");
    expect(result.transformedContent).not.toContain(
      "{% translation item_3 %}"
    );
    expect(result.transformedContent).toContain("<style>");
    expect(result.transformedContent).toContain("</style>");
  });

  it("fails closed when content already contains translation tags", () => {
    const result = tagLiquidTemplate(
      "<p>{% translation item_existing %}Hello{% endtranslation %}</p>"
    );

    expect(result.transformedContent).toBeNull();
    expect(result.translationEntries).toEqual([]);
    expect(result.validationErrors).toHaveLength(1);
    expect(result.validationErrors[0]?.errorCode).toBe("unsupported_content");
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
