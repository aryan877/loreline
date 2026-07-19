import {
  folderResponseSchema,
  moveFolderInputSchema,
} from "@loreline/contracts/folders";
import { FolderService } from "@/modules/folders/service";
import { serializeFolder } from "@/modules/folders/serialization";
import {
  apiError,
  assertRateLimit,
  requireSession,
} from "@/platform/http";
import { runServerEffect } from "@/platform/services";

type FolderRouteContext = {
  params: Promise<{ folderId: string }>;
};

export async function POST(request: Request, context: FolderRouteContext) {
  try {
    const session = await requireSession(request);
    await assertRateLimit(`folder:move:${session.user.id}`, 240, 60 * 60_000);
    const { folderId } = await context.params;
    const input = moveFolderInputSchema.parse(await request.json());
    const folder = await runServerEffect(
      FolderService.moveFolder(session.user.id, { folderId, ...input }),
    );
    return Response.json(
      folderResponseSchema.parse({ folder: serializeFolder(folder) }),
    );
  } catch (error) {
    return apiError(error);
  }
}
