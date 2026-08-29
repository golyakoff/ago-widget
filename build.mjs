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

// `15-07`: the commit this bundle was built from, baked in the same way the version already is.
// The widget is the one artifact here that is *not* loaded from an origin we control - a tenant's
// page fetches ago-chat.js and nothing else, so the version.json the container serves next to it
// (Dockerfile) is not something that page can see. `window.AgoChat.commit` is the widget's own
// answer to the question `GET /healthz/version` answers for the .NET hosts.
//
// Unset means `unknown`, not a failed build - unlike AGO_API_BASE_URL above, which changes what the
// bundle *does*. A developer running `npm run build` to look at the output should get a bundle that
// says "unknown" out loud rather than one that refuses to exist or, worse, claims a commit.
const commit = process.env.AGO_COMMIT || "unknown";

// Measured on a clean build (README's own "Bundle size" section carries the current number and
// the date it was last measured) - this ceiling is a deliberate, small amount of headroom above
// that, not a round number picked in advance.
const GZIP_BUDGET_BYTES = 45 * 1024;

// `8-09`: the demo pages' own boot script - resolves `?site=`, injects the widget's <script> tag with
// the answer, and wires the "get your own tenant" button. **A second entry point, not a second export
// from the widget**, and that separation is the point rather than a packaging detail: `adr/0058` says
// the query parameter belongs to the demo page and never to the widget, because a widget that read it
// could be repointed at another tenant by any page hosting it. Two bundles make that a property of the
// build output instead of a comment somebody has to keep honouring.
//
// It is not counted against the widget's own budget below, because no tenant ever downloads it - it is
// served only alongside the two public demo pages (Dockerfile). Its size is reported anyway, since an
// unwatched artifact is how the first one got big.
await build({
  entryPoints: ["src/demo/boot.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  outfile: "dist/demo-boot.js",
  sourcemap: true,
  define: {
    __AGO_DEFAULT_API_BASE_URL__: JSON.stringify(apiBaseUrl),
  },
});

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
    __AGO_COMMIT__: JSON.stringify(commit),
  },
});

// `20-07`: the booking module's own lazily-loaded chunk - a genuinely separate esbuild entry point,
// not code reached through esbuild's own code-splitting (that mechanism needs `format: "esm"` +
// `splitting: true` and emits shared chunks across *entry points*, which is not this shape: the base
// bundle above stays a single `iife` file loaded by one `<script>` tag, and this is the one thing a
// browser fetches on its own, later, via `ui/moduleLoader.ts`'s runtime `import()`). `format: "esm"`
// here (not `iife`) because native dynamic `import()` expects an ES module on the other end; the
// specifier `ui/moduleLoader.ts` builds is a runtime string esbuild cannot see while bundling
// `src/index.ts` above, which is what keeps `src/modules/**` out of `dist/ago-chat.js`'s own inputs
// (`bundleInputs.test.ts` proves this holds).
await build({
  entryPoints: ["src/modules/booking/chip.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/ago-chat-module-booking.js",
  sourcemap: true,
});

const bundleBytes = readFileSync("dist/ago-chat.js");
const gzipBytes = gzipSync(bundleBytes).length;
const gzipKb = (gzipBytes / 1024).toFixed(1);
const budgetKb = (GZIP_BUDGET_BYTES / 1024).toFixed(0);

console.log(`Bundle: ${(bundleBytes.length / 1024).toFixed(1)} KB raw, ${gzipKb} KB gzipped (budget: ${budgetKb} KB gzipped), commit ${commit}`);

if (gzipBytes > GZIP_BUDGET_BYTES) {
  console.error(`Bundle size ${gzipKb} KB gzipped exceeds the ${budgetKb} KB budget.`);
  process.exit(1);
}

const demoGzipKb = (gzipSync(readFileSync("dist/demo-boot.js")).length / 1024).toFixed(1);
console.log(`Demo boot: ${demoGzipKb} KB gzipped (demo pages only, not part of the widget budget)`);

// `20-07`: fetched only by a site with the booking module enabled, only once - not part of the base
// budget above, the same accounting `demo-boot.js` already gets, for the same reason (a different
// artifact, downloaded by a different subset of visitors, if at all).
const bookingModuleGzipKb = (gzipSync(readFileSync("dist/ago-chat-module-booking.js")).length / 1024).toFixed(2);
console.log(`Booking module: ${bookingModuleGzipKb} KB gzipped (lazily loaded, not part of the widget budget)`);

if (process.env["AGO_WRITE_METAFILE"]) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync("dist/meta.json", JSON.stringify(result.metafile));
}
