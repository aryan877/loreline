import { Effect } from "effect";
import { ownedBook } from "@/book-utils";
import { apiError, requireSession } from "@/http";
import { runServerEffect, StorageService } from "@/services";

export const runtime = "nodejs";

export async function GET(
  _: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  try {
    const session = await requireSession();
    const { bookId } = await context.params;
    const result = await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(bookId, session.user.id);
        const storage = yield* StorageService;
        const bytes = yield* storage.get(book.objectKey);
        return { book, bytes };
      }),
    );
    return new Response(Buffer.from(result.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${result.book.originalFilename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
