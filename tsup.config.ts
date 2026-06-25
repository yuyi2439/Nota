import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts", "src/tui/index.tsx"],
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  splitting: true,
  banner: { js: "#!/usr/bin/env node" },
});
