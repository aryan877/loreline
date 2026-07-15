import { Effect } from "effect";
import { NextResponse } from "next/server";
import { illustrations } from "@/shared/db";
import {
  illustrationInputSchema,
  illustrationResponseSchema,
} from "@/shared/contracts/ai";
import { ownedBook } from "@/server/book-utils";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/server/http";
import {
  DatabaseService,
  OpenAIService,
  runServerEffect,
  StorageService,
} from "@/server/services";
import { callImageModel } from "@/server/openai-contracts";

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
        const openai = yield* OpenAIService;
        if (!openai.client)
          return yield* Effect.fail(
            new HttpError(503, "Visual generation is not available yet."),
          );

        const response = yield* Effect.tryPromise(() =>
          callImageModel(openai.client!, {
            model: openai.imageModel,
            prompt: [
              "Create a thoughtful editorial illustration that helps a reader understand and imagine a passage.",
              "No text, labels, UI, book covers, logos, or watermarks. Sophisticated print texture, clear subject, restrained composition.",
              `Book: ${book.title}. Page: ${input.page}. Reader request: ${input.prompt}.`,
              input.visibleText
                ? `Passage context: ${input.visibleText.slice(0, 5000)}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
          }),
        );
        const encoded = response.data?.[0]?.b64_json;
        if (!encoded)
          return yield* Effect.fail(
            new HttpError(502, "The image model returned no illustration."),
          );
        const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
        const id = crypto.randomUUID();
        const objectKey = `users/${session.user.id}/books/${book.id}/illustrations/${id}.webp`;
        yield* storage.put(objectKey, bytes, "image/webp");
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
          dataUrl: `data:image/webp;base64,${encoded}`,
        });
      }),
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
