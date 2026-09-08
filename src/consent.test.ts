import { describe, expect, it, vi } from "vitest";
import { getConsentRequirement, recordConsent, ConsentRejectedError } from "./consent.js";
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

describe("getConsentRequirement", () => {
  it("GETs the conversation's own consent route, bearer-authenticated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse(200, {
        contactRequired: false,
        contact: null,
        contactAlreadyAccepted: false,
        marketing: null,
        marketingAlreadyAccepted: false,
      }),
    );

    await getConsentRequirement(config, "visitor-token", "conv-1", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.test.invalid/api/v1/conversations/conv-1/consent",
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer visitor-token" } }),
    );
  });

  it("reports not required, with no documents, for a site that never turned the flag on", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse(200, {
        contactRequired: false,
        contact: null,
        contactAlreadyAccepted: false,
        marketing: null,
        marketingAlreadyAccepted: false,
      }),
    );

    const result = await getConsentRequirement(config, "visitor-token", "conv-1", fetchImpl);

    expect(result).toEqual({
      contactRequired: false,
      contact: null,
      contactAlreadyAccepted: false,
      marketing: null,
      marketingAlreadyAccepted: false,
    });
  });

  it("carries the tenant's own title/body through when a document is published", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse(200, {
        contactRequired: true,
        contact: {
          documentKey: "site-consent-contact-...",
          version: "v1",
          title: "We use your number to call you back.",
          body: "Full text.",
          publishedAt: "2026-01-01T00:00:00+00:00",
        },
        contactAlreadyAccepted: false,
        marketing: null,
        marketingAlreadyAccepted: false,
      }),
    );

    const result = await getConsentRequirement(config, "visitor-token", "conv-1", fetchImpl);

    expect(result.contactRequired).toBe(true);
    expect(result.contact).toEqual({ title: "We use your number to call you back.", body: "Full text." });
  });

  it("treats a required document with no published version yet as no document to show", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse(200, {
        contactRequired: true,
        contact: { documentKey: "site-consent-contact-...", version: null, title: null, body: null, publishedAt: null },
        contactAlreadyAccepted: false,
        marketing: null,
        marketingAlreadyAccepted: false,
      }),
    );

    const result = await getConsentRequirement(config, "visitor-token", "conv-1", fetchImpl);

    expect(result.contactRequired).toBe(true);
    expect(result.contact).toBeNull();
  });

  it("throws ConsentRejectedError, carrying the server's own title, on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(404, { title: "Conversation.NotFound" }));

    await expect(getConsentRequirement(config, "visitor-token", "conv-1", fetchImpl)).rejects.toThrow(ConsentRejectedError);
    await expect(getConsentRequirement(config, "visitor-token", "conv-1", fetchImpl)).rejects.toThrow("Conversation.NotFound");
  });
});

describe("recordConsent", () => {
  it("POSTs the purpose to the conversation's own consent route, bearer-authenticated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { id: "acc-1" }));

    await recordConsent(config, "visitor-token", "conv-1", "Contact", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.test.invalid/api/v1/conversations/conv-1/consent",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer visitor-token" },
        body: JSON.stringify({ purpose: "Contact" }),
      }),
    );
  });

  it("sends Marketing verbatim as its own purpose, not folded into Contact", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { id: "acc-2" }));

    await recordConsent(config, "visitor-token", "conv-1", "Marketing", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.test.invalid/api/v1/conversations/conv-1/consent",
      expect.objectContaining({ body: JSON.stringify({ purpose: "Marketing" }) }),
    );
  });

  it("throws ConsentRejectedError on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(503, { title: "Document.ConsentDocumentUnavailable" }));

    await expect(recordConsent(config, "visitor-token", "conv-1", "Contact", fetchImpl)).rejects.toThrow(
      "Document.ConsentDocumentUnavailable",
    );
  });
});
