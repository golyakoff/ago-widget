import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * `20-07` / `adr/0065` §9's second guard - **the first automated version of it in this repository.**
 * Worth saying plainly rather than pretending otherwise: nothing before this test enforced "the base
 * widget bundle has zero inputs from module directories" in code. `20-06`'s own README section
 * ("no tenant embedding the widget downloads a byte of `src/demo/`") reads like precedent for this,
 * but it was prose, checked by hand - `AGO_WRITE_METAFILE`/`dist/meta.json` already existed in
 * `build.mjs`, unused by anything until now. This test is what makes the property real rather than
 * asserted, for `src/modules/` exactly as that section already covered `src/demo/`.
 *
 * Runs a real build (not a mock, not a hand-parsed source scan) with `AGO_WRITE_METAFILE=1` and reads
 * esbuild's own record of what actually went into `dist/widget.js` - the only source of truth for
 * "was this file bundled" a comment or a stale assumption cannot fool. The **fails-before** for this
 * test is a static top-level `import` from `src/modules/booking/chip.ts` added to `src/index.ts` or
 * `src/ui/widget.ts` - with that import present this assertion fails, and reverting it (back to the
 * runtime-computed `import()` `ui/moduleLoader.ts` actually uses) makes it pass again.
 */
describe("the base bundle's own inputs", () => {
  it("contains zero files from src/modules/ (every lazily-loaded module directory)", () => {
    // `vitest run` (this repo's `npm test`) always runs from the package root - `vitest.config.ts`
    // sets no other root - so `process.cwd()` is this repository's own root, the same directory
    // `build.mjs` and `dist/` already live in. Not `import.meta.url`: under this project's Vite-based
    // test transform it does not reliably resolve to a real `file:` URL `fileURLToPath` can parse.
    const repoRoot = process.cwd();

    execFileSync("node", ["build.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGO_API_BASE_URL: "https://bundle-input-guard.invalid",
        AGO_WRITE_METAFILE: "1",
      },
      stdio: "pipe",
    });

    const metaPath = path.join(repoRoot, "dist", "meta.json");
    expect(existsSync(metaPath)).toBe(true);

    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { inputs: Record<string, unknown> };
    const moduleInputs = Object.keys(meta.inputs).filter((input) => input.includes("src/modules/"));

    expect(moduleInputs).toEqual([]);
  });
});
