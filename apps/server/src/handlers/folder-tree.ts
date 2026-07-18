import { NextResponse } from "next/server";
import { folderTreeResponseSchema } from "@loreline/contracts/folders";
import { serializeFolderTree } from "@/handlers/folder-serialization";
import { FolderService } from "@/folder-service";
import { apiError, requireSession } from "@/http";
import { runServerEffect } from "@/services";

export async function GET() {
  try {
    const session = await requireSession();
    const tree = await runServerEffect(FolderService.folderTree(session.user.id));

    return NextResponse.json(
      folderTreeResponseSchema.parse({ tree: serializeFolderTree(tree) }),
    );
  } catch (error) {
    return apiError(error);
  }
}
