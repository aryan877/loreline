import { describe, expect, it, vi } from "vitest";
import { searchTavily } from "@/modules/ai/providers/tavily";

describe("Tavily web search", () => {
  it("uses a bounded basic search and returns source snippets", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            title: "A current source",
            url: "https://example.com/current",
            content: "A recent fact with enough context.",
          },
        ],
      }),
    );

    await expect(
      searchTavily("latest development", {
        apiKey: "test-key",
        fetch: request,
      }),
    ).resolves.toEqual([
      {
        title: "A current source",
        url: "https://example.com/current",
        content: "A recent fact with enough context.",
      },
    ]);
    expect(request).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "latest development",
          search_depth: "basic",
          max_results: 5,
          include_answer: false,
          include_images: false,
          include_raw_content: false,
        }),
      }),
    );
  });
});
