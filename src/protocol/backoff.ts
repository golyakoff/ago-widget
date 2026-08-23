/**
 * Exponential backoff with full jitter (adr/0010, embeddable-widget skill: "without jitter a
 * rolling deploy turns every widget on the internet into a synchronised retry storm"). Same shape
 * as `Ago.Chat.Api/wwwroot/dev-harness.html`'s own reference implementation, ported to TypeScript
 * rather than re-derived, so both clients agree on what "jittered" means for this project.
 */
export interface BackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultBackoffOptions: BackoffOptions = {
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

/** Full-jitter delay for the given 1-based attempt number. */
export function jitteredDelayMs(attempt: number, options: BackoffOptions = defaultBackoffOptions): number {
  const cap = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
  return Math.round(Math.random() * cap);
}
