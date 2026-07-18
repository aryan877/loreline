import { describe, expect, it, vi } from "vitest";
import { compactRealtimeConversation } from "@/modules/ai/providers/compaction";

describe("OpenRouter realtime compaction", () => {
  it("requests private structured memory and validates the result", async () => {
    const memory = {
      summary: "The reader compared two intelligence operations.",
      readerGoals: ["Understand the strategic difference"],
      importantDetails: ["The second operation depended on local networks."],
      discussedPages: [{ page: 14, context: "Origins of the Mossad" }],
      openQuestions: ["How did the strategy change later?"],
    };
    const request = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(memory) } }],
          }),
          { status: 200 },
        );
      },
    );

    const result = await compactRealtimeConversation(
      {
        bookId: "f609be0e-5e1b-4726-9368-93292b05d527",
        page: 14,
        previousMemory: null,
        turns: [{ role: "user", text: "Compare these two operations." }],
      },
      {
        apiKey: "test-key",
        model: "deepseek/deepseek-v4-flash",
        fetch: request,
      },
    );

    expect(result).toEqual(memory);
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      model: "deepseek/deepseek-v4-flash",
      response_format: {
        type: "json_schema",
        json_schema: { strict: true },
      },
      provider: {
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      },
    });
  });
});
