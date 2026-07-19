import { z } from "zod";
import type { WebSearchResult } from "@loreline/contracts/ai";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

const tavilyResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().trim().min(1),
      url: z.url(),
      content: z.string().trim().min(1),
    }),
  ),
});

export type TavilySearchOptions = {
  apiKey: string;
  fetch?: typeof fetch;
};

export class TavilyRequestError extends Error {
  constructor(readonly status: number) {
    super("Tavily search request failed.");
    this.name = "TavilyRequestError";
  }
}

export async function searchTavily(
  query: string,
  options: TavilySearchOptions,
): Promise<WebSearchResult[]> {
  const request = options.fetch ?? fetch;
  const response = await request(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_images: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new TavilyRequestError(response.status);
  const payload: unknown = await response.json();
  return tavilyResponseSchema.parse(payload).results;
}
