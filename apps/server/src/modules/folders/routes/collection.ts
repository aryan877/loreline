import {
  createFolderInputSchema,
  folderResponseSchema,
  foldersResponseSchema,
  getFoldersInputSchema,
} from "@loreline/contracts/folders";
import { FolderService } from "@/modules/folders/service";
import { serializeFolder } from "@/modules/folders/serialization";
import {
  apiError,
  assertRateLimit,
  requireSession,
} from "@/platform/http";
import { runServerEffect } from "@/platform/services";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const input = getFoldersInputSchema.parse({
      parentId: url.searchParams.get("parentId") ?? undefined,
    });
    const folders = await runServerEffect(
      FolderService.getFolders(session.user.id, input.parentId ?? null),
    );
    return Response.json(
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
    const session = await requireSession(request);
    await assertRateLimit(`folder:create:${session.user.id}`, 60, 60 * 60_000);
    const input = createFolderInputSchema.parse(await request.json());
    const folder = await runServerEffect(
      FolderService.createFolder(session.user.id, input),
    );
    return Response.json(
      folderResponseSchema.parse({ folder: serializeFolder(folder) }),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
