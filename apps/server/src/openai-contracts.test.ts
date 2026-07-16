import { describe, expect, it, vi } from "vitest";
import { chunkPages } from "@/book-utils";
import {
  callChatModel,
  callImageModel,
  mintRealtimeClientSecret,
  needsSecondaryBookContext,
  type ChatModelClient,
  type ImageModelClient,
  type RealtimeModelClient,
} from "@/openai-contracts";

describe("Loreline AI contracts", () => {
  it("keeps the visible page primary and expands to RAG only when needed", () => {
    const visible = "A".repeat(300);
    expect(
      needsSecondaryBookContext("What does this sentence mean?", visible),
    ).toBe(false);
    expect(
      needsSecondaryBookContext(
        "Compare this with the earlier chapter",
        visible,
      ),
    ).toBe(true);
    expect(
      chunkPages(["page one ".repeat(80), "page two ".repeat(80)], 900),
    ).toEqual([
      expect.objectContaining({ pageStart: 1, pageEnd: 1 }),
      expect.objectContaining({ pageStart: 2, pageEnd: 2 }),
    ]);
  });

  it("uses official SDK shapes for chat and low-cost visual calls", async () => {
    const responsesCreate = vi
      .fn()
      .mockResolvedValue({ output_text: "Grounded answer" });
    const imagesGenerate = vi
      .fn()
      .mockResolvedValue({ data: [{ b64_json: "abc" }] });
    const chatClient: ChatModelClient = {
      responses: { create: responsesCreate },
    };
    const imageClient: ImageModelClient = {
      images: { generate: imagesGenerate },
    };
    await callChatModel(chatClient, {
      model: "chat-model",
      prompt: "visible page first",
      screenshot: "data:image/jpeg;base64,abc",
    });
    await callImageModel(imageClient, {
      model: "gpt-image-2",
      prompt: "visualize the idea",
    });
    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "chat-model" }),
    );
    expect(imagesGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-image-2",
        quality: "low",
        output_format: "webp",
      }),
    );
  });

  it("mints a short-lived realtime client secret", async () => {
    const create = vi.fn().mockResolvedValue({
      value: "ek_test",
      expires_at: 123,
      session: { type: "realtime", model: "gpt-realtime-2.1-mini" },
    });
    const realtimeClient: RealtimeModelClient = {
      realtime: { clientSecrets: { create } },
    };
    const result = await mintRealtimeClientSecret(realtimeClient, {
      model: "gpt-realtime-2.1-mini",
      bookTitle: "Deep Work",
    });
    expect(result.value).toBe("ek_test");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        expires_after: { anchor: "created_at", seconds: 600 },
      }),
    );
  });
});
