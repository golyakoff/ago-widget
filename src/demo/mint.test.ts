import { describe, expect, it } from "vitest";
import { mintDemoTenant } from "./mint.js";

/** A `fetch` that answers once with whatever this test needs, and records the URL it was called with. */
function fakeFetch(response: Response): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl: typeof fetch = (input) => {
    // Every call site here passes a string. Narrowed explicitly rather than stringified, because a
    // Request would otherwise become "[object Object]" and the URL assertions would silently pass.
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(response);
  };

  return { fetch: impl, calls };
}

/** A `fetch` that fails the way an unreachable host does - a rejected promise, not an error status. */
const unreachableFetch: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));

function problem(status: number, body: Record<string, unknown>, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", ...headers },
  });
}

describe("mintDemoTenant", () => {
  it("posts to the endpoint 8-07 exposes, with no body", async () => {
    const minted = {
      username: "demo-a1b2c3d4",
      password: "swordfish-2026",
      siteName: "Demo tenant — expires 2026-08-27 09:00 UTC",
      sitePublicKey: "demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071",
      visitorUrl: "https://demo-shop1.example/?site=demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071",
      expiresAt: "2026-08-27T09:00:00+00:00",
    };
    const { fetch, calls } = fakeFetch(new Response(JSON.stringify(minted), { status: 200 }));

    const outcome = await mintDemoTenant("https://chat.example", fetch);

    expect(calls).toEqual(["https://chat.example/api/v1/demo/credentials"]);
    expect(outcome).toEqual({ kind: "minted", tenant: minted });
  });

  it("does not double the slash when the base url has a trailing one", async () => {
    const { fetch, calls } = fakeFetch(new Response("{}", { status: 200 }));

    await mintDemoTenant("https://chat.example/", fetch);

    expect(calls).toEqual(["https://chat.example/api/v1/demo/credentials"]);
  });

  /**
   * `429` is an ordinary state on a busy day, not a fault - `8-07` rate-limits per IP. Reported as its
   * own kind so the UI can say "wait a moment" rather than "something went wrong".
   */
  it("reports a rate limit, with the retry window when the header carries one", async () => {
    const { fetch } = fakeFetch(
      problem(429, { title: "demo.rate_limited", detail: "Too many demo tenants requested." }, { "retry-after": "90" }),
    );

    expect(await mintDemoTenant("https://chat.example", fetch)).toEqual({
      kind: "rateLimited",
      retryAfterSeconds: 90,
    });
  });

  it("reports a rate limit with no window when the header is absent or unparseable", async () => {
    const missing = fakeFetch(problem(429, { title: "demo.rate_limited" }));
    expect(await mintDemoTenant("https://chat.example", missing.fetch)).toEqual({
      kind: "rateLimited",
      retryAfterSeconds: null,
    });

    // A date-form Retry-After is legal HTTP and this API never sends one; it must become null rather
    // than NaN, or the UI would offer to retry "in NaN seconds".
    const dated = fakeFetch(problem(429, {}, { "retry-after": "Wed, 27 Aug 2026 09:00:00 GMT" }));
    expect(await mintDemoTenant("https://chat.example", dated.fetch)).toEqual({
      kind: "rateLimited",
      retryAfterSeconds: null,
    });
  });

  /**
   * The cap is the other ordinary state, and it is a *different* message: the rate limit clears by
   * waiting a moment, the cap clears when somebody else's tenant expires. Telling them apart is the
   * reason this is matched on the error code rather than on the status alone.
   */
  it("reports the total cap separately from the rate limit", async () => {
    const { fetch } = fakeFetch(
      problem(409, {
        title: "demo.capacity_reached",
        detail: "The demo is at its limit of 50 simultaneous tenants.",
      }),
    );

    expect(await mintDemoTenant("https://chat.example", fetch)).toEqual({ kind: "atCapacity" });
  });

  it("reports the feature being switched off", async () => {
    const { fetch } = fakeFetch(problem(400, { title: "demo.disabled" }));

    expect(await mintDemoTenant("https://chat.example", fetch)).toEqual({ kind: "disabled" });
  });

  it("falls back to the problem detail for anything else", async () => {
    const { fetch } = fakeFetch(problem(500, { detail: "Could not mint a demo tenant. Try again." }));

    expect(await mintDemoTenant("https://chat.example", fetch)).toEqual({
      kind: "failed",
      detail: "Could not mint a demo tenant. Try again.",
    });
  });

  it("survives an unreachable API rather than throwing at the caller", async () => {
    const outcome = await mintDemoTenant("https://chat.example", unreachableFetch);

    expect(outcome.kind).toBe("failed");
    // Narrowed rather than matched loosely, so this asserts the message a person actually sees.
    if (outcome.kind === "failed") {
      expect(outcome.detail).toContain("Could not reach");
    }
  });

  it("survives a success response whose body is not JSON", async () => {
    const { fetch } = fakeFetch(new Response("<html>gateway</html>", { status: 200 }));

    expect((await mintDemoTenant("https://chat.example", fetch)).kind).toBe("failed");
  });
});
