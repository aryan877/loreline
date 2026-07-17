import { describe, expect, it } from "vitest";
import { DEFAULT_AUTH_REDIRECT, safeAuthRedirect } from "./auth-redirect";

describe("safeAuthRedirect", () => {
  it("keeps internal application paths", () => {
    expect(safeAuthRedirect("/library/book-1?page=2")).toBe(
      "/library/book-1?page=2",
    );
  });

  it.each([null, undefined, "", "https://example.com", "//example.com", "javascript:alert(1)"])(
    "falls back for an unsafe destination: %s",
    (destination) => {
      expect(safeAuthRedirect(destination)).toBe(DEFAULT_AUTH_REDIRECT);
    },
  );
});
