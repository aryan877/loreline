import { NextResponse } from "next/server";
import {
  folderResponseSchema,
  renameFolderInputSchema,
} from "@loreline/contracts/folders";
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
    const folder = await runServerEffect(
      FolderService.getFolder(session.user.id, folderId),
    );

    return NextResponse.json(
      folderResponseSchema.parse({ folder: serializeFolder(folder) }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: FolderRouteContext) {
  try {
    const session = await requireSession();
    const { folderId } = await context.params;
    const input = renameFolderInputSchema.parse(await request.json());
    const folder = await runServerEffect(
      FolderService.renameFolder(session.user.id, { folderId, ...input }),
    );

    return NextResponse.json(
      folderResponseSchema.parse({ folder: serializeFolder(folder) }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, context: FolderRouteContext) {
  try {
    const session = await requireSession();
    const { folderId } = await context.params;
    const folder = await runServerEffect(
      FolderService.deleteFolder(session.user.id, folderId),
    );

    return NextResponse.json(
      folderResponseSchema.parse({ folder: serializeFolder(folder) }),
    );
  } catch (error) {
    return apiError(error);
  }
}
