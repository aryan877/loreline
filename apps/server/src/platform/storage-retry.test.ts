import { describe, expect, it, vi } from "vitest";
import { retryTransientStorage } from "@/platform/storage-retry";

describe("R2 transient retry", () => {
  it("retries a transient TLS upload failure", async () => {
    const tlsFailure = Object.assign(new Error("bad record mac"), {
      code: "ERR_SSL_SSL/TLS_ALERT_BAD_RECORD_MAC",
    });
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(tlsFailure)
      .mockResolvedValue("stored");
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      retryTransientStorage(operation, { sleep }),
    ).resolves.toBe("stored");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it("does not retry permanent storage failures", async () => {
    const operation = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("Access denied"));

    await expect(
      retryTransientStorage(operation, { sleep: vi.fn() }),
    ).rejects.toThrow("Access denied");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
