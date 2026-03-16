import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@braze-ai-translator/csv-utils": resolve(
        __dirname,
        "packages/csv-utils/src/index.ts"
      ),
      "@braze-ai-translator/liquid-engine": resolve(
        __dirname,
        "packages/liquid-engine/src/index.ts"
      ),
      "@braze-ai-translator/schemas": resolve(
        __dirname,
        "packages/schemas/src/index.ts"
      )
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"]
  }
});
