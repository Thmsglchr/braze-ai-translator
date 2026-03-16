import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDirectory = resolve(import.meta.dirname, "..");
const contentScriptPaths = [
  "dist/adapters/runtime.js",
  "dist/adapters/brazeAdapterShared.js",
  "dist/adapters/genericPageAdapter.js",
  "dist/adapters/brazePageAdapter.js",
  "dist/contentScript.js"
];

await Promise.all(
  contentScriptPaths.map(async (relativePath) => {
    const absolutePath = resolve(rootDirectory, relativePath);
    const originalSource = await readFile(absolutePath, "utf8");
    const normalizedSource = originalSource.replace(
      /\nexport \{\};\n\/\/# sourceMappingURL=/,
      "\n//# sourceMappingURL="
    );

    if (normalizedSource !== originalSource) {
      await writeFile(absolutePath, normalizedSource, "utf8");
    }
  })
);
