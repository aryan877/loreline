import { NextResponse } from "next/server";
import {
  createFolderInputSchema,
  foldersResponseSchema,
  getFoldersInputSchema,
  folderResponseSchema,
} from "@loreline/contracts/folders";
import { serializeFolder } from "@/handlers/folder-serialization";
import { FolderService } from "@/folder-service";
import { apiError, requireSession } from "@/http";
import { runServerEffect } from "@/services";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const input = getFoldersInputSchema.parse({
      parentId: url.searchParams.get("parentId") ?? undefined,
    });
    const folders = await runServerEffect(
      FolderService.getFolders(session.user.id, input.parentId ?? null),
    );

    return NextResponse.json(
      foldersResponseSchema.parse({
        folders: folders.map(serializeFolder),
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const input = createFolderInputSchema.parse(await request.json());
    const folder = await runServerEffect(
      FolderService.createFolder(session.user.id, input),
    );

    return NextResponse.json(
      folderResponseSchema.parse({ folder: serializeFolder(folder) }),
    );
  } catch (error) {
    return apiError(error);
  }
}
