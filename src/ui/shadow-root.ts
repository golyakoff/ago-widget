import { widgetStyles } from "./styles.js";

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
  style.textContent = widgetStyles;
  root.appendChild(style);

  return { host, root };
}
