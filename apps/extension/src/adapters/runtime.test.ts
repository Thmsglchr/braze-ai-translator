import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Script } from "node:vm";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface RuntimeTestContext {
  getAdapterRuntime: () => AdapterRuntime;
  globalThis: RuntimeTestContext;
}

function loadAdapterRuntime(): AdapterRuntime {
  const sourcePath = resolve(
    process.cwd(),
    "apps/extension/src/adapters/runtime.ts"
  );
  const sourceCode = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceCode, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022
    }
  });
  const context = {} as RuntimeTestContext;

  context.globalThis = context;

  new Script(transpiled.outputText).runInNewContext(context);

  return context.getAdapterRuntime();
}

describe("adapterRuntime", () => {
  it("normalizes extension context invalidation into a reload instruction", () => {
    const runtime = loadAdapterRuntime();

    expect(
      runtime.normalizeExtensionRuntimeError(
        new Error("Extension context invalidated.")
      )
    ).toBe(
      "The extension was reloaded or updated while this page was open. Refresh the Braze page and reopen the extension."
    );
  });

  it("returns generic runtime messages unchanged", () => {
    const runtime = loadAdapterRuntime();

    expect(runtime.normalizeExtensionRuntimeError("No receiving end")).toBe(
      "No receiving end"
    );
  });
});
