import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  splitting: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  dts: true,
  format: ["esm"]
})