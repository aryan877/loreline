import { folderTreeResponseSchema } from "@loreline/contracts/folders";
import { FolderService } from "@/modules/folders/service";
import { serializeFolderTree } from "@/modules/folders/serialization";
import { apiError, requireSession } from "@/platform/http";
import { runServerEffect } from "@/platform/services";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const tree = await runServerEffect(
      FolderService.folderTree(session.user.id),
    );
    return Response.json(
      folderTreeResponseSchema.parse({ tree: serializeFolderTree(tree) }),
    );
  } catch (error) {
    return apiError(error);
  }
}
