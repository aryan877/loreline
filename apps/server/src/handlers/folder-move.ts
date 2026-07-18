import { NextResponse } from "next/server";
import {
  folderResponseSchema,
  moveFolderInputSchema,
} from "@loreline/contracts/folders";
import { serializeFolder } from "@/handlers/folder-serialization";
import { FolderService } from "@/folder-service";
import { apiError, requireSession } from "@/http";
import { runServerEffect } from "@/services";

type FolderRouteContext = {
  params: Promise<{ folderId: string }>;
};

export async function POST(request: Request, context: FolderRouteContext) {
  try {
    const session = await requireSession();
    const { folderId } = await context.params;
    const input = moveFolderInputSchema.parse(await request.json());
    const folder = await runServerEffect(
      FolderService.moveFolder(session.user.id, { folderId, ...input }),
    );

    return NextResponse.json(
      folderResponseSchema.parse({ folder: serializeFolder(folder) }),
    );
  } catch (error) {
    return apiError(error);
  }
}
