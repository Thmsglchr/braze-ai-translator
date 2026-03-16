import { describe, expect, it, vi } from "vitest";

import type { ExtractedContentPayload, TransformResult } from "@braze-ai-translator/schemas";

import { postTransform } from "./backendClient.js";

function createPayload(): ExtractedContentPayload {
  return {
    extractionId: "extract.extension.demo",
    sourcePlatform: "braze",
    sourceWorkspaceId: "workspace_demo",
    sourceMessageId: "message_demo",
    messageChannel: "email",
    contentFieldKey: "debug.visible_text",
    contentFieldType: "plain_text",
    sourceLocale: "en-US",
    rawContent: "Hello world",
    contentChecksum: "sha256:raw",
    detectedLiquid: false,
    translationEntries: [],
    validationErrors: [],
    extractedAt: "2026-03-15T19:00:00.000Z"
  };
}

describe("postTransform", () => {
  it("posts the extracted payload to the backend transform endpoint", async () => {
    const payload = createPayload();
    const transformResult = {
      transformId: "transform.extension.demo",
      extractionId: payload.extractionId,
      transformStatus: "success",
      originalContent: payload.rawContent,
      transformedContent: "{% translation item_1 %}Hello world{% endtranslation %}",
      contentChanged: true,
      appliedTranslationTagCount: 1,
      translationEntries: [],
      validationErrors: [],
      generatedAt: "2026-03-15T19:00:10.000Z"
    } satisfies TransformResult;
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(transformResult), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const response = await postTransform("http://127.0.0.1:8787", payload, fetchFn);

    expect(response.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/transform",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("returns structured backend errors when the transform request fails", async () => {
    const payload = createPayload();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          errorCode: "invalid_request",
          message: "Request body must match the extracted content payload contract.",
          validationErrors: []
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const response = await postTransform("http://127.0.0.1:8787/", payload, fetchFn);

    expect(response.ok).toBe(false);
    expect(response.statusCode).toBe(400);
    expect(response.apiError?.errorCode).toBe("invalid_request");
  });
});
