import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { inspectLiquidTemplate } from "./index.js";

describe("inspectLiquidTemplate", () => {
  it("preserves the original fixture content exactly", () => {
    const fixturePath = resolve(
      process.cwd(),
      "tests/fixtures/sample-message.liquid"
    );
    const fixture = readFileSync(fixturePath, "utf8");

    const result = inspectLiquidTemplate(fixture);

    expect(result.original).toBe(fixture);
    expect(result.translatableSegments).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("fails closed for empty input", () => {
    const result = inspectLiquidTemplate("");

    expect(result.translatableSegments).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: "empty_template",
        message: "Template content must not be empty."
      }
    ]);
  });
});
