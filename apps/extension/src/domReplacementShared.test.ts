import { describe, expect, it } from "vitest";

import {
  findNormalizedMatchOutsideTranslationTags,
  findNormalizedTextRangeInSegments,
  findRawSubstringMatch,
  replaceTextByNormalizedMatch
} from "./domReplacementShared.js";

describe("domReplacementShared", () => {
  it("replaces a direct text match", () => {
    expect(
      replaceTextByNormalizedMatch(
        "We miss you, {{${first_name}}}!",
        "We miss you, {{${first_name}}}!",
        "{% translation title %}We miss you, {{${first_name}}}!{% endtranslation %}"
      )
    ).toBe(
      "{% translation title %}We miss you, {{${first_name}}}!{% endtranslation %}"
    );
  });

  it("replaces a match when Monaco rendered NBSP characters", () => {
    expect(
      replaceTextByNormalizedMatch(
        "We\u00a0miss\u00a0you,\u00a0{{${first_name}}}!",
        "We miss you, {{${first_name}}}!",
        "{% translation title %}We miss you, {{${first_name}}}!{% endtranslation %}"
      )
    ).toBe(
      "{% translation title %}We miss you, {{${first_name}}}!{% endtranslation %}"
    );
  });

  it("returns null when the selected text is not present", () => {
    expect(
      replaceTextByNormalizedMatch(
        "Come back soon!",
        "We miss you!",
        "{% translation title %}We miss you!{% endtranslation %}"
      )
    ).toBeNull();
  });

  it("ignores matches that are already wrapped in translation tags", () => {
    expect(
      findNormalizedMatchOutsideTranslationTags(
        "{% translation Hello %}Hello {{${first_name}}},{% endtranslation %}",
        "Hello {{${first_name}}},"
      )
    ).toBe(-1);
  });

  it("prefers an unwrapped occurrence when wrapped and unwrapped copies coexist", () => {
    expect(
      findNormalizedMatchOutsideTranslationTags(
        "{% translation Hello %}Hello {{${first_name}}},{% endtranslation %} Hello {{${first_name}}},",
        "Hello {{${first_name}}},"
      )
    ).toBeGreaterThanOrEqual(0);
  });

  it("maps a normalized match back to raw string offsets", () => {
    expect(findRawSubstringMatch("a\u00a0b", "a b", 0)).toEqual({
      start: 0,
      end: 3
    });
  });

  it("finds a normalized match across multiple text segments", () => {
    expect(
      findNormalizedTextRangeInSegments(
        ["We\u00a0miss\u00a0you,\u00a0{{", "${first_name}", "}}!"],
        "We miss you, {{${first_name}}}!"
      )
    ).toEqual({
      startSegmentIndex: 0,
      startOffset: 0,
      endSegmentIndex: 2,
      endOffset: 3
    });
  });
});
