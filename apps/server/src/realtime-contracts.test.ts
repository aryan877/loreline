import { describe, expect, it, vi } from "vitest";
import {
  mintRealtimeClientSecret,
  type RealtimeModelClient,
} from "@/realtime-contracts";

describe("Loreline Realtime contract", () => {
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
