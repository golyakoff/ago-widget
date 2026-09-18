import { describe, expect, it, vi } from "vitest";
import { getUnreadCount } from "./unreadCount.js";
import type { WidgetConfig } from "./config.js";

const config: WidgetConfig = {
  siteKey: "shop_test",
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  policyBaseUrl: "https://office.test.invalid",
  scriptUrl: "https://cdn.test.invalid/dist/widget.js",
};

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("getUnreadCount", () => {
  it("GETs the conversation's own unread-count route, bearer-authenticated, with afterSequence on the query string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { count: 3 }));

    const count = await getUnreadCount(config, "visitor-token", "conv-1", 5, fetchImpl);

    expect(count).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.test.invalid/api/v1/conversations/conv-1/unread-count?afterSequence=5",
      { headers: { Authorization: "Bearer visitor-token" } },
    );
  });

  it("omits afterSequence entirely when this visitor has never had a read position - the endpoint's own contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { count: 0 }));

    await getUnreadCount(config, "visitor-token", "conv-1", null, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.test.invalid/api/v1/conversations/conv-1/unread-count",
      { headers: { Authorization: "Bearer visitor-token" } },
    );
  });

  it("resolves to 0, never throws, on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(403, { title: "Forbidden" }));

    await expect(getUnreadCount(config, "visitor-token", "conv-1", null, fetchImpl)).resolves.toBe(0);
  });

  it("resolves to 0, never throws, on a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getUnreadCount(config, "visitor-token", "conv-1", null, fetchImpl)).resolves.toBe(0);
  });

  it("resolves to 0 for a malformed body - a missing or non-numeric count is not trusted blindly", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { count: "not-a-number" }));

    await expect(getUnreadCount(config, "visitor-token", "conv-1", null, fetchImpl)).resolves.toBe(0);
  });

  it("resolves to 0 for a negative count - a server bug is not trusted onto a badge either", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { count: -1 }));

    await expect(getUnreadCount(config, "visitor-token", "conv-1", null, fetchImpl)).resolves.toBe(0);
  });
});
