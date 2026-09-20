import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `build.mjs`'s own `minify: true` (four times) is esbuild's *JavaScript* minifier - it has no idea
 * `ui/styles.ts` (a JS template literal) held CSS, so it never touched a single byte inside that
 * string: every comment and all the indentation shipped to production verbatim, which is exactly
 * what once pushed the gzipped bundle over its own size budget for no functional reason. Moved to a
 * real `ui/styles.css`, minified once through esbuild's own CSS-aware `transform`, inlined via the
 * `__AGO_WIDGET_CSS__` define.
 *
 * Runs a real build (not a mock, not a hand-parsed source scan) and greps the actual
 * `dist/widget.js` bytes - the same "the artifact is the only source of truth" discipline
 * `bundleInputs.test.ts` already uses for its own guard. The **fails-before** for this test is
 * `ui/styles.ts`'s own pre-minification shape (a raw CSS template literal, comments included) -
 * confirmed directly by reverting this item's own changes, rebuilding, and watching the distinctive
 * comment text below reappear in `dist/widget.js`.
 */
describe("the widget's own injected CSS", () => {
  it("ships with its source comments stripped, and its real rules intact", () => {
    const repoRoot = process.cwd();

    execFileSync("node", ["build.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGO_API_BASE_URL: "https://css-minification-guard.invalid",
        AGO_POLICY_BASE_URL: "https://office.css-minification-guard.invalid",
      },
      stdio: "pipe",
    });

    const bundle = readFileSync(path.join(repoRoot, "dist", "widget.js"), "utf8");
    const cssSource = readFileSync(path.join(repoRoot, "src", "ui", "styles.css"), "utf8");

    // A real, distinctive sentence from styles.css's own prose comments - present in source,
    // must not survive into the built artifact.
    const knownComment = "the widget's own built-in default";
    expect(cssSource).toContain(knownComment);
    expect(bundle).not.toContain(knownComment);

    // The actual rule this comment sits beside must still be there - proving the CSS itself
    // shipped, not that it was accidentally dropped along with its comment.
    expect(bundle).toContain("--ago-accent");
  });
});
