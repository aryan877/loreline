import { Effect } from "effect";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/platform/http";
import { RealtimeService, runServerEffect } from "@/platform/services";
import { mintRealtimeClientSecret } from "@/modules/ai/realtime/contracts";
import {
  LORELINE_REALTIME_MODEL_ID,
  realtimeTokenInputSchema,
  realtimeTokenResponseSchema,
} from "@loreline/contracts/ai";

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    await assertRateLimit(`realtime:${session.user.id}`, 20, 60 * 60 * 1000);
    const body = realtimeTokenInputSchema.parse(
      await request.json().catch(() => ({})),
    );

    const result = await runServerEffect(
      Effect.gen(function* () {
        const openai = yield* RealtimeService;
        const client = openai.client;
        if (!client)
          return yield* Effect.fail(
            new HttpError(503, "Realtime voice is not available yet."),
          );
        return yield* Effect.tryPromise(() =>
          mintRealtimeClientSecret(client, {
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
          ? (result.session.model ?? LORELINE_REALTIME_MODEL_ID)
          : LORELINE_REALTIME_MODEL_ID,
    });
    return Response.json(response);
  } catch (error) {
    return apiError(error);
  }
}
