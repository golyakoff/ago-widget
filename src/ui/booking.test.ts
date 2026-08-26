import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "../config.js";
import { resetFakeSignalR } from "../testing/fakeSignalR.js";

/**
 * `20-06`: booking inside the widget the shop already embeds.
 *
 * <b>The first test is the whole embed decision, expressed as an assertion.</b> There is one script
 * tag, one launcher and one panel; the booking flow is a view inside it. A second floating button
 * would be the second embed the 2026-08-26 boundary review ruled out, and a test that only checked
 * "the booking view renders" would pass with two of them on the page.
 *
 * The rest is the property that a shop which did not buy booking pays nothing: no button, and no
 * request to a product it does not have.
 */
vi.mock("@microsoft/signalr", () => import("../testing/fakeSignalR.js"));

const { ChatWidget } = await import("./widget.js");

const chatOnly: WidgetConfig = {
  siteKey: "shop_test",
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  booking: null,
};

const withBooking: WidgetConfig = {
  ...chatOnly,
  booking: { publicKey: "barbershop", apiBaseUrl: "https://calendar.test.invalid" },
};

/** Drains the microtask queue the fakes' resolved promises sit on. Deeper than `widget.test.ts`'s
 * five: a booking step is a fetch, a `Response.json()` and a `guardAsync` wrapper, which is a longer
 * chain than a visitor session's. No timers are involved, so there is nothing to advance. */
async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await Promise.resolve();
  }
}

async function mount(config: WidgetConfig): Promise<ShadowRoot> {
  const widget = new ChatWidget(config);
  widget.mount(document.body);
  await flush();

  const host = document.querySelector("[data-ago-chat-widget]");
  if (host?.shadowRoot == null) {
    throw new Error("the widget did not mount");
  }

  return host.shadowRoot;
}

/** `fetch`'s first argument is a string, a `URL` or a `Request`, and only the first stringifies
 * usefully - hence the narrowing rather than a `String(...)` that would read `[object Object]` for a
 * `Request` and make every assertion below vacuously true. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/** The chat session request plus, when booking is configured and opened, AGO Calendar's surface.
 * Routed by URL so the test can assert *which* product was contacted. */
function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = urlOf(input);

    if (url.includes("calendar.test.invalid")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            tenantName: "Barbershop",
            calendars: [
              {
                calendarId: "cal-1",
                name: "Main",
                timeZone: "Europe/Moscow",
                services: [{ serviceId: "svc-1", name: "Haircut", durationMinutes: 45 }],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(
      new Response(
        JSON.stringify({
          token: "visitor-token",
          visitorId: "99999999-9999-9999-9999-999999999999",
          widgetPrimaryColorHex: null,
          widgetPosition: "BottomRight",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetFakeSignalR();
  document.body.innerHTML = "";
  localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("booking inside the chat widget", () => {
  it("adds no second launcher and no second panel", async () => {
    // One embed, one floating button, one dialog. This is `20-06`'s embed decision as an assertion.
    const root = await mount(withBooking);

    expect(root.querySelectorAll(".ago-toggle")).toHaveLength(1);
    expect(root.querySelectorAll(".ago-panel")).toHaveLength(1);
    expect(document.querySelectorAll("[data-ago-chat-widget]")).toHaveLength(1);
  });

  it("shows no Book button and contacts no calendar when the embed did not ask for booking", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    const root = await mount(chatOnly);

    root.querySelector<HTMLButtonElement>(".ago-toggle")!.click();
    await flush();

    expect(root.querySelector(".ago-book")).toBeNull();
    expect(root.querySelector(".ago-booking")).toBeNull();
    expect(fetchMock.mock.calls.every((call) => !urlOf(call[0]).includes("calendar"))).toBe(true);
  });

  it("contacts the calendar only once the visitor asks to book", async () => {
    // Nothing heavy before the interaction that needs it - the embeddable-widget skill's own rule,
    // applied to a whole second product.
    const fetchMock = vi.mocked(globalThis.fetch);
    const root = await mount(withBooking);

    root.querySelector<HTMLButtonElement>(".ago-toggle")!.click();
    await flush();
    expect(fetchMock.mock.calls.some((call) => urlOf(call[0]).includes("calendar.test.invalid"))).toBe(false);

    root.querySelector<HTMLButtonElement>(".ago-book")!.click();
    await flush();

    const calendarCall = fetchMock.mock.calls.find((call) => urlOf(call[0]).includes("calendar.test.invalid"));
    expect(calendarCall).toBeDefined();

    // The tenant key travels in a path segment, never a body - `5-01`'s preflight-timing finding, and
    // the reason the server's routes are shaped this way.
    expect(urlOf(calendarCall![0])).toContain("/api/v1/embed/barbershop");
  });

  it("swaps the panel between the conversation and the booking flow, and back", async () => {
    const root = await mount(withBooking);
    root.querySelector<HTMLButtonElement>(".ago-toggle")!.click();
    await flush();

    const book = root.querySelector<HTMLButtonElement>(".ago-book")!;
    const messages = root.querySelector<HTMLDivElement>(".ago-messages")!;
    const booking = root.querySelector<HTMLDivElement>(".ago-booking")!;

    expect(booking.hidden).toBe(true);

    book.click();
    await flush();
    expect(booking.hidden).toBe(false);
    expect(messages.hidden).toBe(true);
    expect(book.textContent).toBe("Chat");

    book.click();
    await flush();
    // The transcript is hidden, never torn down - coming back returns to the same conversation on
    // the same connection.
    expect(booking.hidden).toBe(true);
    expect(messages.hidden).toBe(false);
    expect(book.textContent).toBe("Book");
  });

  it("says booking is unavailable rather than sitting on the loading step for ever", async () => {
    // **A regression test for a defect found by driving the built bundle against a real server**,
    // from an origin the tenant had not approved. The server refused the surface, the rejection
    // reached `guardAsync` - whose job is to keep a throw off the host page, not to tell anybody
    // anything - and the panel showed "Loading available times…" indefinitely: a spinner that was
    // really an error.
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        urlOf(input).includes("calendar.test.invalid")
          ? Promise.resolve(new Response(null, { status: 404 }))
          : Promise.resolve(
              new Response(
                JSON.stringify({
                  token: "visitor-token",
                  visitorId: "99999999-9999-9999-9999-999999999999",
                  widgetPrimaryColorHex: null,
                  widgetPosition: "BottomRight",
                }),
                { status: 201, headers: { "Content-Type": "application/json" } },
              ),
            ),
      ),
    );

    const root = await mount(withBooking);
    root.querySelector<HTMLButtonElement>(".ago-toggle")!.click();
    await flush();
    root.querySelector<HTMLButtonElement>(".ago-book")!.click();
    await flush();

    const body = root.querySelector(".ago-booking-body")!.textContent ?? "";
    expect(body).not.toContain("Loading");
    expect(body).toContain("not available");

    // And no free-text box, because nothing is being asked.
    expect(root.querySelector<HTMLFormElement>(".ago-booking-form")!.hidden).toBe(true);
  });

  it("renders the first question as labelled choices, not as a grid", async () => {
    const root = await mount(withBooking);
    root.querySelector<HTMLButtonElement>(".ago-toggle")!.click();
    await flush();
    root.querySelector<HTMLButtonElement>(".ago-book")!.click();
    await flush();

    const choices = [...root.querySelectorAll<HTMLButtonElement>(".ago-booking-choice")];

    // One button per action, labelled exactly as a numbered list would print it. That equivalence is
    // what makes the same step renderable on a channel with no UI - proved directly in
    // booking/steps.test.ts.
    expect(choices.map((choice) => choice.textContent)).toEqual(["Haircut (45 min)"]);
    expect(root.querySelector(".ago-booking-body")!.textContent).toBe("What would you like to book?");
  });
});
