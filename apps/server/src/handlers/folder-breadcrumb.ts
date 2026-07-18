import { NextResponse } from "next/server";
import { folderBreadcrumbResponseSchema } from "@loreline/contracts/folders";
import { serializeFolder } from "@/handlers/folder-serialization";
import { FolderService } from "@/folder-service";
import { apiError, requireSession } from "@/http";
import { runServerEffect } from "@/services";

type FolderRouteContext = {
  params: Promise<{ folderId: string }>;
};

export async function GET(_: Request, context: FolderRouteContext) {
  try {
    const session = await requireSession();
    const { folderId } = await context.params;
    const breadcrumb = await runServerEffect(
      FolderService.folderBreadcrumb(session.user.id, folderId),
    );

    return NextResponse.json(
      folderBreadcrumbResponseSchema.parse({
        breadcrumb: breadcrumb.map(serializeFolder),
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
