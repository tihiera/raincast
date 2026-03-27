import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    core: "src/core.ts",
    node: "src/node.ts",
    browser: "src/browser.ts",
    prompts: "src/prompts.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: true,
  clean: true,
  outDir: "dist",
})
