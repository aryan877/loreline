import { describe, expect, it } from "vitest";
import {
  beginBookUploadInputSchema,
  MAX_BOOK_FILE_SIZE,
} from "./books";

describe("book upload contract", () => {
  it("preserves the PDF type and 50 MB size boundary", () => {
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
