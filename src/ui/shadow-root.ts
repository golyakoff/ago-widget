/**
 * `ui/styles.css`, minified and inlined at build time (`build.mjs`'s own esbuild CSS transform) -
 * a real `.css` file rather than a JS template literal, so a CSS-aware minifier can actually strip
 * its comments and whitespace instead of shipping them as literal bytes inside the JS bundle (found
 * live: a single verbose comment there once pushed the gzipped bundle over its own size budget).
 * `vitest.config.ts` defines this identically for tests, from the same unminified source file.
 */
declare const __AGO_WIDGET_CSS__: string;

/**
 * Style isolation via Shadow DOM (embeddable-widget skill's Hard constraints): the host's styles
 * must not leak in and ours must not leak out. `mode: "open"` (not "closed") is a deliberate
 * choice - a closed root would also block this widget's own code (and its tests, and a reviewer's
 * devtools) from inspecting it, for a privacy benefit the widget does not need since it holds no
 * secret DOM state.
 */
export function createShadowHost(): { host: HTMLDivElement; root: ShadowRoot } {
  const host = document.createElement("div");
  host.setAttribute("data-ago-chat-widget", "");
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = __AGO_WIDGET_CSS__;
  root.appendChild(style);

  return { host, root };
}
