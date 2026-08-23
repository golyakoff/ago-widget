/**
 * embeddable-widget skill, Hard constraints: "every entry point is wrapped so an internal failure
 * degrades to 'no widget', never to a broken site. An exception escaping into a shop's page is the
 * worst possible bug." This is that wrapping, used at every boundary between this widget's own
 * code and the host page's event loop (bootstrap, DOM event handlers, connection callbacks).
 */
export function logWidgetError(error: unknown): void {
  // console.error only, never console.log: never transmit or persist page content
  // (embeddable-widget skill's Storage and privacy section) - an error object itself is the one
  // thing this widget is allowed to surface, since it never contains visitor-typed content.
  console.error("[AGO Chat widget]", error);
}

export function guardSync(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    logWidgetError(error);
  }
}

export function guardAsync(fn: () => Promise<void>): void {
  fn().catch(logWidgetError);
}
