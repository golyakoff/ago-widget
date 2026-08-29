/**
 * `20-07`: loads one of `build.mjs`'s lazily-built module bundles at runtime, and is deliberately
 * generic - it has never imported anything from `src/modules/`, not even a type, and a second module
 * (were one ever built - `adr/0065` §8: there is no module runtime, Calendar is the sole
 * implementation) would call this exact function with a different file name.
 *
 * **Why a runtime-computed URL, not a relative specifier.** `import("../modules/booking/chip.js")`
 * written as a string literal is exactly the shape esbuild *can* resolve at build time, and it would
 * happily inline the whole module back into `dist/ago-chat.js` - silently defeating the split this
 * item exists to build. `fileName` only ever becomes part of a URL assembled at runtime
 * (`new URL(...)`), so the argument `import()` actually receives is a variable esbuild cannot
 * statically resolve - the same reason esbuild leaves an unresolvable dynamic import alone rather
 * than bundling it, is what keeps `src/modules/**` out of the base bundle's own inputs
 * (`bundleInputs.test.ts` proves this holds, not just asserts it).
 *
 * **Why resolved against the widget's own `<script src>`, not `window.location`.** The host page's
 * own address is a different origin from wherever this bundle is actually served (a shop's page vs.
 * a CDN) - `config.ts`'s `scriptUrl` is the one address this widget can trust for "where am I", the
 * same reasoning `index.ts`'s bootstrap already applies to `document.currentScript`.
 */
export function moduleBundleUrl(scriptUrl: string, fileName: string): string {
  return new URL(fileName, scriptUrl).href;
}

export async function loadModule<T>(scriptUrl: string, fileName: string): Promise<T> {
  const url = moduleBundleUrl(scriptUrl, fileName);
  return (await import(/* @vite-ignore */ url)) as T;
}
