// Bundles the widget to a single IIFE file, then enforces the bundle-size ceiling
// (embeddable-widget skill: "a hard ceiling, checked on every build ... stated in the README").
// esbuild rather than a bigger bundler/framework toolchain - the widget has no JSX, no CSS
// modules, no code-splitting need (it is one entry point, loaded by one <script> tag), so
// esbuild's minimal, fast IIFE output is the whole feature set this build needs.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const apiBaseUrl = process.env.AGO_API_BASE_URL;
if (!apiBaseUrl) {
  console.error(
    "AGO_API_BASE_URL is not set. There is no real hosted deployment for this portfolio project " +
      "to default to (CLAUDE.md: 'do not invent numbers, benchmarks, or endpoints') - set it " +
      "explicitly, e.g. AGO_API_BASE_URL=http://localhost:5009 for the local cluster.",
  );
  process.exit(1);
}

// Measured on a clean build (README's own "Bundle size" section carries the current number and
// the date it was last measured) - this ceiling is a deliberate, small amount of headroom above
// that, not a round number picked in advance.
const GZIP_BUDGET_BYTES = 45 * 1024;

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  outfile: "dist/ago-chat.js",
  sourcemap: true,
  metafile: true,
  define: {
    __AGO_WIDGET_VERSION__: JSON.stringify(packageJson.version),
    __AGO_DEFAULT_API_BASE_URL__: JSON.stringify(apiBaseUrl),
  },
});

const bundleBytes = readFileSync("dist/ago-chat.js");
const gzipBytes = gzipSync(bundleBytes).length;
const gzipKb = (gzipBytes / 1024).toFixed(1);
const budgetKb = (GZIP_BUDGET_BYTES / 1024).toFixed(0);

console.log(`Bundle: ${(bundleBytes.length / 1024).toFixed(1)} KB raw, ${gzipKb} KB gzipped (budget: ${budgetKb} KB gzipped)`);

if (gzipBytes > GZIP_BUDGET_BYTES) {
  console.error(`Bundle size ${gzipKb} KB gzipped exceeds the ${budgetKb} KB budget.`);
  process.exit(1);
}

if (process.env["AGO_WRITE_METAFILE"]) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync("dist/meta.json", JSON.stringify(result.metafile));
}
