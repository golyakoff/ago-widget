import { readConfig } from "./config.js";
import { ChatWidget } from "./ui/widget.js";
import { guardSync } from "./errors.js";

declare const __AGO_WIDGET_VERSION__: string;

interface AgoChatGlobal {
  version: string;
}

declare global {
  interface Window {
    AgoChat?: AgoChatGlobal;
  }
}

// Must run synchronously, before any `await` - `document.currentScript` is only valid for the
// duration of this classic script's own synchronous execution (embeddable-widget skill's Bootstrap
// section: "data-site on the script tag identifies the tenant").
const scriptElement = document.currentScript;

guardSync(() => {
  // One optional global, nothing else touches `window` (embeddable-widget skill's Hard
  // constraints). Its presence also doubles as the "already embedded" guard - a shop that
  // accidentally includes the tag twice gets one widget, not two fighting over the same
  // localStorage keys and Shadow DOM host.
  if (window.AgoChat) {
    return;
  }

  window.AgoChat = { version: __AGO_WIDGET_VERSION__ };

  if (!(scriptElement instanceof HTMLScriptElement)) {
    throw new Error("AGO Chat widget: could not locate its own <script> tag.");
  }

  const config = readConfig(scriptElement);
  const widget = new ChatWidget(config);

  const mount = (): void => guardSync(() => widget.mount(document.body));
  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  }
});
