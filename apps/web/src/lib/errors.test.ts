import { describe, expect, it } from "vitest";
import {
  DEFAULT_ERROR_MESSAGE,
  toUserMessage,
  UserFacingError,
} from "@/lib/errors";

describe("public error boundary", () => {
  it("shows deliberate errors and hides internal failures", () => {
    expect(toUserMessage(new UserFacingError("Choose a PDF."))).toBe(
      "Choose a PDF.",
    );
    expect(toUserMessage(new Error("database connection string leaked"))).toBe(
      DEFAULT_ERROR_MESSAGE,
    );
  });
});
