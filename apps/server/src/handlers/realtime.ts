import { Effect } from "effect";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/http";
import { OpenAIService, runServerEffect } from "@/services";
import { mintRealtimeClientSecret } from "@/openai-contracts";
import {
  realtimeTokenInputSchema,
  realtimeTokenResponseSchema,
} from "@loreline/contracts/ai";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    await assertRateLimit(`realtime:${session.user.id}`, 20, 60 * 60 * 1000);
    const body = realtimeTokenInputSchema.parse(
      await request.json().catch(() => ({})),
    );

    const result = await runServerEffect(
      Effect.gen(function* () {
        const openai = yield* OpenAIService;
        if (!openai.client)
          return yield* Effect.fail(
            new HttpError(503, "Realtime voice is not available yet."),
          );
        return yield* Effect.tryPromise(() =>
          mintRealtimeClientSecret(openai.client!, {
            model: openai.realtimeModel,
            bookTitle: body.bookTitle,
          }),
        );
      }),
    );
    const response = realtimeTokenResponseSchema.parse({
      clientSecret: result.value,
      expiresAt: result.expires_at,
      model:
        result.session.type === "realtime"
          ? (result.session.model ?? "gpt-realtime-2.1-mini")
          : "gpt-realtime-2.1-mini",
    });
    return Response.json(response);
  } catch (error) {
    return apiError(error);
  }
}
