import { describe, expect, it, vi } from "vitest";
import { BOOK_EMBEDDING_DIMENSIONS } from "@loreline/database/schema";
import {
  createOpenRouterEmbeddings,
  generateOpenRouterImage,
  OpenRouterRequestError,
} from "@/modules/ai/providers/openrouter";

describe("OpenRouter media contracts", () => {
  it("keeps illustration generation on the low-cost image setting", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        data: [{ b64_json: "encoded-image" }],
        usage: { cost: 0.007 },
      }),
    );

    const image = await generateOpenRouterImage("visualize this passage", {
      apiKey: "test-key",
      model: "openai/gpt-image-1-mini",
      fetch: request,
    });

    expect(request).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/images",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "openai/gpt-image-1-mini",
          prompt: "visualize this passage",
          quality: "low",
          n: 1,
        }),
      }),
    );
    expect(image).toEqual({
      encoded: "encoded-image",
      mediaType: "image/png",
      costUsd: 0.007,
    });
  });

  it("keeps OpenRouter embeddings compatible with stored book vectors", async () => {
    const embedding = Array.from(
      { length: BOOK_EMBEDDING_DIMENSIONS },
      () => 0,
    );
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [{ index: 0, embedding }] }));

    const result = await createOpenRouterEmbeddings("reader question", {
      apiKey: "test-key",
      model: "openai/text-embedding-3-small",
      fetch: request,
    });

    expect(request).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/embeddings",
      expect.objectContaining({
        body: JSON.stringify({
          model: "openai/text-embedding-3-small",
          input: "reader question",
          dimensions: BOOK_EMBEDDING_DIMENSIONS,
          encoding_format: "float",
          provider: { allow_fallbacks: true, data_collection: "deny" },
        }),
      }),
    );
    expect(result).toEqual([embedding]);
  });

  it("rejects provider errors even when OpenRouter responds with HTTP 200", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({ error: { message: "Provider input limit exceeded" } }),
    );

    await expect(
      createOpenRouterEmbeddings(["first", "second"], {
        apiKey: "test-key",
        model: "openai/text-embedding-3-small",
        fetch: request,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<OpenRouterRequestError>>({
        name: "OpenRouterRequestError",
        message: "Provider input limit exceeded",
      }),
    );
  });
});
