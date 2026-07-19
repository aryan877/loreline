import {
  deleteFolderInputSchema,
  deleteFolderResponseSchema,
  folderResponseSchema,
  renameFolderInputSchema,
} from "@loreline/contracts/folders";
import { FolderService } from "@/modules/folders/service";
import { serializeFolder } from "@/modules/folders/serialization";
import { apiError, assertRateLimit, requireSession } from "@/platform/http";
import { runServerEffect } from "@/platform/services";

type FolderRouteContext = {
  params: Promise<{ folderId: string }>;
};

export async function GET(request: Request, context: FolderRouteContext) {
  try {
    const session = await requireSession(request);
    const { folderId } = await context.params;
    const folder = await runServerEffect(
      FolderService.getFolderSummary(session.user.id, folderId),
    );
    return Response.json(
      folderResponseSchema.parse({ folder: serializeFolder(folder) }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: FolderRouteContext) {
  try {
    const session = await requireSession(request);
    await assertRateLimit(`folder:update:${session.user.id}`, 120, 60 * 60_000);
    const { folderId } = await context.params;
    const input = renameFolderInputSchema.parse(await request.json());
    const folder = await runServerEffect(
      FolderService.renameFolder(session.user.id, { folderId, ...input }),
    );
    return Response.json(
      folderResponseSchema.parse({ folder: serializeFolder(folder) }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: FolderRouteContext) {
  try {
    const session = await requireSession(request);
    await assertRateLimit(`folder:delete:${session.user.id}`, 60, 60 * 60_000);
    const { folderId } = await context.params;
    const input = deleteFolderInputSchema.parse(await request.json());
    const folder = await runServerEffect(
      FolderService.deleteFolder(session.user.id, {
        folderId,
        confirmation: input.confirmation,
      }),
    );
    return Response.json(deleteFolderResponseSchema.parse({ folder }));
  } catch (error) {
    return apiError(error);
  }
}
