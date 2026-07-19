import { folderBreadcrumbResponseSchema } from "@loreline/contracts/folders";
import { FolderService } from "@/modules/folders/service";
import { serializeFolder } from "@/modules/folders/serialization";
import { apiError, requireSession } from "@/platform/http";
import { runServerEffect } from "@/platform/services";

type FolderRouteContext = {
  params: Promise<{ folderId: string }>;
};

export async function GET(request: Request, context: FolderRouteContext) {
  try {
    const session = await requireSession(request);
    const { folderId } = await context.params;
    const breadcrumb = await runServerEffect(
      FolderService.folderBreadcrumb(session.user.id, folderId),
    );
    return Response.json(
      folderBreadcrumbResponseSchema.parse({
        breadcrumb: breadcrumb.map(serializeFolder),
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
