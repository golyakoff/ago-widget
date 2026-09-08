import { describe, expect, it, vi } from "vitest";
import { recordContactDetail, ContactDetailRejectedError } from "./contactDetails.js";
import type { WidgetConfig } from "./config.js";

const config: WidgetConfig = {
  siteKey: "shop_test",
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  scriptUrl: "https://cdn.test.invalid/dist/widget.js",
};

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("recordContactDetail", () => {
  it("POSTs kind/value to the conversation's own contact-details route, bearer-authenticated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { id: "cd-1" }));

    await recordContactDetail(config, "visitor-token", "conv-1", "Phone", "+7 000 000-00-01", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.test.invalid/api/v1/conversations/conv-1/contact-details",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer visitor-token" },
        body: JSON.stringify({ kind: "Phone", value: "+7 000 000-00-01" }),
      }),
    );
  });

  it("throws ContactDetailRejectedError, carrying the server's own title, on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(400, { title: "A contact detail cannot be empty." }));

    await expect(recordContactDetail(config, "visitor-token", "conv-1", "Phone", "", fetchImpl)).rejects.toThrow(
      ContactDetailRejectedError,
    );
    await expect(recordContactDetail(config, "visitor-token", "conv-1", "Phone", "", fetchImpl)).rejects.toThrow(
      "A contact detail cannot be empty.",
    );
  });

  it("falls back to a generic message when the error body has no title", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(429, {}));

    await expect(recordContactDetail(config, "visitor-token", "conv-1", "Phone", "x", fetchImpl)).rejects.toThrow(
      "Request failed: 429",
    );
  });
});
