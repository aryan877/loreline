import { Effect } from "effect";
import { NextResponse } from "next/server";
import { illustrations } from "@loreline/database/schema";
import {
  illustrationInputSchema,
  illustrationResponseSchema,
} from "@loreline/contracts/ai";
import { ownedBook } from "@/book-utils";
import { apiError, assertRateLimit, HttpError, requireSession } from "@/http";
import { DatabaseService, runServerEffect, StorageService } from "@/services";
import { AppConfigTag } from "@/config";
import { generateOpenRouterImage } from "@/openrouter-client";

const imageExtension = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    await assertRateLimit(`image:${session.user.id}`, 12, 60 * 60 * 1000);
    const input = illustrationInputSchema.parse(await request.json());
    const result = await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(input.bookId, session.user.id);
        const { db } = yield* DatabaseService;
        const storage = yield* StorageService;
        const config = yield* AppConfigTag;
        if (!config.openRouterApiKey)
          return yield* Effect.fail(
            new HttpError(503, "Visual generation is not available yet."),
          );

        const image = yield* Effect.tryPromise(() =>
          generateOpenRouterImage(
            [
              "Create a thoughtful editorial illustration that helps a reader understand and imagine a passage.",
              "No text, labels, UI, book covers, logos, or watermarks. Sophisticated print texture, clear subject, restrained composition.",
              `Book: ${book.title}. Page: ${input.page}. Reader request: ${input.prompt}.`,
              input.visibleText
                ? `Passage context: ${input.visibleText.slice(0, 3000)}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
            {
              apiKey: config.openRouterApiKey!,
              model: config.openRouterImageModel,
            },
          ),
        );
        const bytes = Uint8Array.from(Buffer.from(image.encoded, "base64"));
        const id = crypto.randomUUID();
        const objectKey = `users/${session.user.id}/books/${book.id}/illustrations/${id}.${imageExtension[image.mediaType]}`;
        yield* storage.put(objectKey, bytes, image.mediaType);
        const [saved] = yield* Effect.tryPromise(() =>
          db
            .insert(illustrations)
            .values({
              id,
              bookId: book.id,
              userId: session.user.id,
              page: input.page,
              prompt: input.prompt,
              objectKey,
            })
            .returning({
              id: illustrations.id,
              createdAt: illustrations.createdAt,
            }),
        );
        return illustrationResponseSchema.parse({
          id: saved.id,
          createdAt: saved.createdAt.toISOString(),
          dataUrl: `data:${image.mediaType};base64,${image.encoded}`,
        });
      }),
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
