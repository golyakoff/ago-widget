import { afterEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "./config.js";
import { sendBeacon } from "./beacon.js";

/**
 * `23-07`'s own beacon - a pure function of its three arguments, tested directly rather than only
 * through `ChatWidget`'s own mount/open call sites (`widget.test.ts` covers those).
 */
describe("sendBeacon", () => {
  const config: WidgetConfig = {
    siteKey: "shop_test",
    apiBaseUrl: "https://api.test.invalid",
    demoNotice: "none",
    policyBaseUrl: "https://office.test.invalid",
    scriptUrl: "https://cdn.test.invalid/dist/widget.js",
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the site key and kind to /api/v1/widget-activity, nothing else", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

    sendBeacon(config, fetchMock, "load");

    expect(fetchMock).toHaveBeenCalledWith("https://api.test.invalid/api/v1/widget-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: "shop_test", kind: "load" }),
    });
  });

  it("sends the open kind unchanged", () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );

    sendBeacon(config, fetchMock, "open");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({ publicKey: "shop_test", kind: "open" });
  });

  /**
   * The whole point of "fire and forget" (this function's own doc comment): a rejected fetch -
   * offline, a `429`, DNS failure, anything - must never become an unhandled rejection the host page
   * could observe. Nothing is awaited here; the assertion is that constructing and immediately
   * returning from `sendBeacon` does not itself throw, and that a later microtask processing the
   * rejection does not produce an `unhandledrejection`.
   */
  it("never throws and never leaves an unhandled rejection when the request fails", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("network down")));
    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);

    expect(() => sendBeacon(config, fetchMock, "load")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(unhandled).not.toHaveBeenCalled();
  });
});
