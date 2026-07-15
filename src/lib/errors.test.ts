import { describe, expect, it } from "vitest";
import {
  beginBookUploadInputSchema,
  MAX_BOOK_FILE_SIZE,
} from "@/shared/contracts";
import {
  DEFAULT_ERROR_MESSAGE,
  toUserMessage,
  UserFacingError,
} from "./errors";

describe("public error and upload boundaries", () => {
  it("shows deliberate errors and hides internal failures", () => {
    expect(toUserMessage(new UserFacingError("Choose a PDF."))).toBe(
      "Choose a PDF.",
    );
    expect(toUserMessage(new Error("database connection string leaked"))).toBe(
      DEFAULT_ERROR_MESSAGE,
    );
  });

  it("rejects oversized or non-PDF upload requests", () => {
    const input = {
      fileName: "book.pdf",
      fileSize: MAX_BOOK_FILE_SIZE,
      contentType: "application/pdf" as const,
    };
    expect(beginBookUploadInputSchema.safeParse(input).success).toBe(true);
    expect(
      beginBookUploadInputSchema.safeParse({
        ...input,
        fileSize: MAX_BOOK_FILE_SIZE + 1,
      }).success,
    ).toBe(false);
    expect(
      beginBookUploadInputSchema.safeParse({
        ...input,
        fileName: "not-a-book.txt",
      }).success,
    ).toBe(false);
  });
});
