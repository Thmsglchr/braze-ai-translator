import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BrazeTemplateSourceDataSchema,
  type BrazeTemplatePushRequest
} from "@braze-ai-translator/schemas";

import { BrazeRestTemplateClient } from "./brazeTemplate.js";

const fixedNow = "2026-03-15T19:00:00.000Z";
const testApiKey = "test-braze-api-key";
const testBaseUrl = "https://rest.test.braze.com";

function createClient(): BrazeRestTemplateClient {
  return new BrazeRestTemplateClient({
    now: () => fixedNow,
    apiKey: testApiKey,
    restApiBaseUrl: testBaseUrl,
    sourceLocale: "en-US"
  });
}

const sampleTemplateBody =
  "<div><p>Hello {{ first_name }},</p><p>Your order is ready.</p></div>";

function mockFetchForGet(body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        email_template_id: "tmpl-abc-123",
        template_name: "Order Ready",
        subject: "Your order is ready",
        preheader: "Tap to see details",
        body,
        created_at: "2026-03-10T10:00:00.000Z",
        updated_at: "2026-03-12T15:30:00.000Z"
      }),
      text: async () => ""
    })
  );
}

function mockFetchForGetThenUpdate(body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/templates/email/info")) {
        return {
          ok: true,
          json: async () => ({
            email_template_id: "tmpl-abc-123",
            template_name: "Order Ready",
            subject: "Your order is ready",
            body,
            created_at: "2026-03-10T10:00:00.000Z",
            updated_at: "2026-03-12T15:30:00.000Z"
          }),
          text: async () => ""
        };
      }

      if (url.includes("/templates/email/update")) {
        return {
          ok: true,
          json: async () => ({ message: "success" }),
          text: async () => ""
        };
      }

      if (
        url.includes("/templates/email/translations") &&
        init?.method === "GET"
      ) {
        return {
          ok: true,
          json: async () => ({
            translations: [
              {
                translation_map: {},
                locale: {
                  uuid: "locale-uuid-fr-fr",
                  name: "fr-FR",
                  country: "FR",
                  language: "fr",
                  locale_key: "fr-fr"
                }
              }
            ],
            message: "success"
          }),
          text: async () => ""
        };
      }

      if (
        url.includes("/templates/email/translations") &&
        init?.method === "PUT"
      ) {
        return {
          ok: true,
          json: async () => ({ message: "success" }),
          text: async () => ""
        };
      }

      return {
        ok: false,
        status: 404,
        text: async () => "Not found"
      };
    })
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BrazeRestTemplateClient", () => {
  describe("fetchTemplateSourceData", () => {
    it("calls the Braze GET endpoint and returns parsed translation entries", async () => {
      mockFetchForGet(sampleTemplateBody);
      const client = createClient();

      const result = await client.fetchTemplateSourceData({
        templateId: "tmpl-abc-123",
        targetLocales: ["fr-FR"]
      });

      expect(result.templateId).toBe("tmpl-abc-123");
      expect(result.sourceLocale).toBe("en-US");
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.validationErrors).toEqual([]);
      expect(result.existingTranslations).toEqual([]);

      const entryTexts = result.entries.map((entry) => entry.sourceText);

      expect(entryTexts).toContain("Hello {{ first_name }},");
      expect(entryTexts).toContain("Your order is ready.");

      BrazeTemplateSourceDataSchema.parse(result);
    });

    it("passes the API key as a Bearer token", async () => {
      mockFetchForGet(sampleTemplateBody);
      const client = createClient();

      await client.fetchTemplateSourceData({
        templateId: "tmpl-abc-123",
        targetLocales: ["fr-FR"]
      });

      const fetchMock = vi.mocked(fetch);

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0] ?? [];

      expect(url).toContain("/templates/email/info");
      expect(url).toContain("email_template_id=tmpl-abc-123");
      expect((options as RequestInit)?.headers).toEqual(
        expect.objectContaining({
          Authorization: `Bearer ${testApiKey}`
        })
      );
    });

    it("throws when the template body is empty", async () => {
      mockFetchForGet("");
      const client = createClient();

      await expect(
        client.fetchTemplateSourceData({
          templateId: "tmpl-empty",
          targetLocales: ["fr-FR"]
        })
      ).rejects.toThrow("no body content");
    });

    it("throws when the Braze API returns a non-OK status", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: async () => "Unauthorized"
        })
      );

      const client = createClient();

      await expect(
        client.fetchTemplateSourceData({
          templateId: "tmpl-abc-123",
          targetLocales: ["fr-FR"]
        })
      ).rejects.toThrow("401");
    });
  });

  describe("pushTranslations", () => {
    it("calls the Braze POST update endpoint with the tagged body", async () => {
      mockFetchForGetThenUpdate(sampleTemplateBody);
      const client = createClient();

      await client.fetchTemplateSourceData({
        templateId: "tmpl-abc-123",
        targetLocales: ["fr-FR"]
      });

      const pushRequest: BrazeTemplatePushRequest = {
        templateId: "tmpl-abc-123",
        newTranslations: [
          {
            entryId: "item_1",
            targetLocale: "fr-FR",
            translatedText: "Bonjour {{ first_name }},",
            translatedTextChecksum: "sha256:bonjour",
            validationErrors: []
          }
        ],
        mergedTranslations: [
          {
            entryId: "item_1",
            targetLocale: "fr-FR",
            translatedText: "Bonjour {{ first_name }},",
            translatedTextChecksum: "sha256:bonjour",
            validationErrors: []
          }
        ],
        requestedAt: fixedNow
      };

      const result = await client.pushTranslations(pushRequest);

      expect(result.pushStatus).toBe("success");
      expect(result.pushedTranslationCount).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.syncStatus).toBe("synced");

      const fetchMock = vi.mocked(fetch);
      const updateCall = fetchMock.mock.calls.find(([url]) =>
        (url as string).includes("/templates/email/update")
      );

      expect(updateCall).toBeDefined();

      const updateBody = JSON.parse(
        (updateCall?.[1] as RequestInit)?.body as string
      ) as Record<string, unknown>;

      expect(updateBody.email_template_id).toBe("tmpl-abc-123");
      expect(updateBody.body).toContain("{% translation item_1 %}");
      expect(updateBody.body).toContain("{% endtranslation %}");

      const putCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          (url as string).includes("/templates/email/translations") &&
          (init as RequestInit | undefined)?.method === "PUT"
      );

      expect(putCall).toBeDefined();

      const putBody = JSON.parse(
        (putCall?.[1] as RequestInit)?.body as string
      ) as Record<string, unknown>;

      expect(putBody.template_id).toBe("tmpl-abc-123");
      expect(putBody.locale_id).toBe("locale-uuid-fr-fr");
      expect(putBody.translation_map).toEqual({
        item_1: "Bonjour {{ first_name }},"
      });
    });

    it("throws when fetchTemplateSourceData was not called first", async () => {
      const client = createClient();

      await expect(
        client.pushTranslations({
          templateId: "tmpl-unknown",
          newTranslations: [],
          mergedTranslations: [],
          requestedAt: fixedNow
        } as unknown as BrazeTemplatePushRequest)
      ).rejects.toThrow("No tagged template body cached");
    });
  });
});
