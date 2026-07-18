import { Effect } from "effect";
import {
  realtimeCompactionInputSchema,
  realtimeCompactionResponseSchema,
} from "@loreline/contracts/ai";
import { ownedBook } from "@/modules/books/text";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/platform/http";
import { compactRealtimeConversation } from "@/modules/ai/providers/compaction";
import { AppConfigTag } from "@/platform/config";
import { runServerEffect } from "@/platform/services";

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    await assertRateLimit(
      `realtime-compact:${session.user.id}`,
      24,
      60 * 60 * 1000,
    );
    const input = realtimeCompactionInputSchema.parse(await request.json());

    const memory = await runServerEffect(
      Effect.gen(function* () {
        yield* ownedBook(input.bookId, session.user.id);
        const config = yield* AppConfigTag;
        const apiKey = config.openRouterApiKey;
        if (!apiKey)
          return yield* Effect.fail(
            new HttpError(503, "Long-session memory is not configured yet."),
          );

        return yield* Effect.tryPromise({
          try: () =>
            compactRealtimeConversation(input, {
              apiKey,
              model: config.compactionModel,
            }),
          catch: (cause) => {
            console.error("Realtime compaction failed", cause);
            return new HttpError(
              503,
              "Long-session memory is temporarily unavailable.",
            );
          },
        });
      }),
    );

    return Response.json(realtimeCompactionResponseSchema.parse({ memory }));
  } catch (error) {
    return apiError(error);
  }
}
