/**
 * **The one file in this repository that knows AGO Calendar exists.**
 *
 * That is deliberate and it is worth naming rather than leaving to be discovered. The boundary
 * review of 2026-08-26 identified exactly this as the trap "book inside the chat window" sets: *"it
 * did not ask whether AGO Chat's widget would come to know about AGO Calendar - which is the natural
 * way to build it, and which is a product-to-product dependency in the client, exactly the kind the
 * repository split exists to prevent."*
 *
 * Three things keep that dependency from spreading, and none of them is a promise:
 *
 * 1. **It is one module, and everything above it is product-neutral.** `steps.ts` is
 *    `adr/0061`'s (kind, payload, actions) shape and names no product. `flow.ts` turns answers into
 *    steps and never mentions a URL. The UI renders steps. Replace this file and the rest still
 *    works - which is the shape `21-01` needs, because there the same steps arrive as conversation
 *    content instead of as HTTP responses.
 * 2. **It is reached only when the embed asks for it.** No `data-booking` attribute, no calendar
 *    key, no module ever imported at runtime and no request ever made. A shop with chat and no
 *    booking pays nothing.
 * 3. **It is HTTP against a published contract, not a shared type.** Nothing is imported from
 *    `ago-calendar`; these interfaces are this client's reading of a documented API, the same
 *    relationship `repositories.md` already records between `ago-widget` and "the public API
 *    contract".
 *
 * What is genuinely not resolved here, and is `21-01`'s: **who decides that a visitor wants to
 * book.** In the widget it is a button, so nobody parses anything. Over a channel with no UI there
 * is only text, and that question is explicitly left open (`adr/0061`'s own Consequences).
 */

/** What a script tag has to supply for any of this to happen. */
export interface BookingConfig {
  /** AGO Calendar's own tenant public key - a different value from `data-site`, because the two
   * products own separate databases and separate tenants (`adr/0027`). */
  readonly publicKey: string;
  /** AGO Calendar's API origin. Separate from the chat API's: they are separate deployables. */
  readonly apiBaseUrl: string;
}

export interface BookableService {
  readonly serviceId: string;
  readonly name: string;
  readonly durationMinutes: number;
}

export interface BookableCalendar {
  readonly calendarId: string;
  readonly name: string;
  readonly timeZone: string;
  readonly services: readonly BookableService[];
}

export interface BookingSurface {
  readonly tenantName: string;
  readonly calendars: readonly BookableCalendar[];
}

export interface BookableWorker {
  readonly workerId: string;
  readonly displayName: string;
}

export interface OpenSlot {
  readonly bookingId: string;
  readonly workerId: string;
  readonly workerDisplayName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly localDate: string;
}

export interface BookingConfirmation {
  readonly bookingId: string;
  readonly workerId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly localDate: string;
}

/** The failures a caller has to tell apart. Everything else is `BookingUnavailableError`, because a
 * visitor's next action is the same for all of them: try again or give up. */
export class BookingUnavailableError extends Error {
  constructor(message = "Booking is not available right now.") {
    super(message);
    this.name = "BookingUnavailableError";
  }
}

/** The slot was taken between the list and the claim. **An ordinary Tuesday** (`adr/0059`: a lost
 * race is not an error), and the only failure the flow reacts to rather than reports. */
export class SlotTakenError extends Error {
  constructor() {
    super("Sorry, that time has just been taken.");
    this.name = "SlotTakenError";
  }
}

export class BookingRateLimitedError extends Error {
  constructor() {
    super("Too many booking attempts. Please wait a moment and try again.");
    this.name = "BookingRateLimitedError";
  }
}

/**
 * Reads AGO Calendar's public booking surface and claims a slot on it.
 *
 * **Every read carries the tenant's public key in a path segment**, which is not cosmetic: `5-01`
 * found live that a browser's CORS preflight sees the URL and the `Origin` header and never the
 * request body, so a tenant identified from a body cannot be identified during a preflight at all.
 * The server's own `TenantPublicKey` doc comment records the same finding from the other side.
 */
export class CalendarClient {
  private readonly base: string;

  constructor(private readonly config: BookingConfig) {
    this.base = `${config.apiBaseUrl.replace(/\/+$/, "")}/api/v1/embed/${encodeURIComponent(config.publicKey)}`;
  }

  async getSurface(signal?: AbortSignal): Promise<BookingSurface> {
    return this.readJson<BookingSurface>(this.base, signal);
  }

  async getWorkers(calendarId: string, serviceId: string, signal?: AbortSignal): Promise<readonly BookableWorker[]> {
    const url = `${this.base}/calendars/${encodeURIComponent(calendarId)}/workers?serviceId=${encodeURIComponent(serviceId)}`;
    return this.readJson<BookableWorker[]>(url, signal);
  }

  async getSlots(
    calendarId: string,
    serviceId: string,
    workerId: string | null,
    signal?: AbortSignal,
  ): Promise<readonly OpenSlot[]> {
    const worker = workerId === null ? "" : `&workerId=${encodeURIComponent(workerId)}`;
    const url = `${this.base}/calendars/${encodeURIComponent(calendarId)}/slots?serviceId=${encodeURIComponent(serviceId)}${worker}`;
    return this.readJson<OpenSlot[]>(url, signal);
  }

  /**
   * The one write. Note the URL: it is **not** under `/embed/{publicKey}` - it is `20-03`'s own
   * endpoint, which names a calendar and an event and existed before this item. The server resolves
   * the tenant from the calendar and then runs the same per-tenant origin check the reads run
   * (`OriginPolicy`), which is what makes the two halves one boundary rather than two.
   */
  async book(
    calendarId: string,
    bookingId: string,
    serviceId: string,
    phone: string,
    displayName: string | null,
    signal?: AbortSignal,
  ): Promise<BookingConfirmation> {
    const url =
      `${this.config.apiBaseUrl.replace(/\/+$/, "")}` +
      `/api/v1/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(bookingId)}/book`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, phone, displayName }),
        signal: signal ?? null,
      });
    } catch {
      throw new BookingUnavailableError();
    }

    if (response.status === 409) {
      throw new SlotTakenError();
    }
    if (response.status === 429) {
      throw new BookingRateLimitedError();
    }
    if (!response.ok) {
      // 400 covers a phone the server refused. Its problem-details `detail` is written for a human
      // and is the one server message worth showing verbatim - everything else is collapsed.
      const detail = await readProblemDetail(response);
      throw new BookingUnavailableError(detail ?? undefined);
    }

    return (await response.json()) as BookingConfirmation;
  }

  private async readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: "application/json" }, signal: signal ?? null });
    } catch {
      // A network failure and a CORS refusal are indistinguishable to a page by design - the browser
      // deliberately tells JavaScript nothing about a response it was not allowed to read. So the
      // widget cannot report "your origin is not approved" even when that is exactly what happened,
      // and saying so here is more useful than a message that guesses.
      throw new BookingUnavailableError();
    }

    if (!response.ok) {
      throw new BookingUnavailableError();
    }

    return (await response.json()) as T;
  }
}

async function readProblemDetail(response: Response): Promise<string | null> {
  try {
    const problem = (await response.json()) as { detail?: unknown };
    return typeof problem.detail === "string" ? problem.detail : null;
  } catch {
    return null;
  }
}
