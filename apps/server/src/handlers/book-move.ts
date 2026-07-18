import { NextResponse } from "next/server";
import {
  moveBookInputSchema,
  moveBookResponseSchema,
} from "@loreline/contracts/folders";
import { FolderService } from "@/folder-service";
import { apiError, requireSession } from "@/http";
import { runServerEffect } from "@/services";

type BookRouteContext = {
  params: Promise<{ bookId: string }>;
};

export async function POST(request: Request, context: BookRouteContext) {
  try {
    const session = await requireSession();
    const { bookId } = await context.params;
    const input = moveBookInputSchema.parse(await request.json());
    const book = await runServerEffect(
      FolderService.moveBook(session.user.id, { bookId, ...input }),
    );

    return NextResponse.json(
      moveBookResponseSchema.parse({
        book: { id: book.id, folderId: book.folderId },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
