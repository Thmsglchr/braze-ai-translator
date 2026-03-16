import { describe, expect, it } from "vitest";

import {
  didMonacoContentChange,
  joinMonacoRenderedLines,
  normalizeMonacoRenderedText
} from "./monacoEditorShared.js";

describe("monacoEditorShared", () => {
  it("normalizes Monaco-rendered whitespace", () => {
    expect(normalizeMonacoRenderedText("Hello\u00a0world\u200b!")).toBe(
      "Hello world!"
    );
  });

  it("joins rendered Monaco lines into plain text", () => {
    expect(joinMonacoRenderedLines(["First\u00a0line", "Second line"])).toBe(
      "First line\nSecond line"
    );
  });

  it("detects when tagged Monaco content was inserted", () => {
    expect(
      didMonacoContentChange(
        "We miss you, {{${first_name}}}!",
        "{% translation title %}We miss you, {{${first_name}}}!{% endtranslation %}",
        "{% translation title %}We miss you, {{${first_name}}}!{% endtranslation %}"
      )
    ).toBe(true);
  });

  it("rejects unchanged or unrelated Monaco updates", () => {
    expect(didMonacoContentChange("before", "before", "{% translation x %}before{% endtranslation %}")).toBe(false);
    expect(didMonacoContentChange("before", "after", "{% translation x %}before{% endtranslation %}")).toBe(false);
  });
});
