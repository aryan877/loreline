import {
  moveBookInputSchema,
  moveBookResponseSchema,
} from "@loreline/contracts/folders";
import { FolderService } from "@/modules/folders/service";
import {
  apiError,
  assertRateLimit,
  requireSession,
} from "@/platform/http";
import { runServerEffect } from "@/platform/services";

type BookRouteContext = {
  params: Promise<{ bookId: string }>;
};

export async function POST(request: Request, context: BookRouteContext) {
  try {
    const session = await requireSession(request);
    await assertRateLimit(`book:move:${session.user.id}`, 240, 60 * 60_000);
    const { bookId } = await context.params;
    const input = moveBookInputSchema.parse(await request.json());
    const book = await runServerEffect(
      FolderService.moveBook(session.user.id, { bookId, ...input }),
    );
    return Response.json(moveBookResponseSchema.parse({ book }));
  } catch (error) {
    return apiError(error);
  }
}
