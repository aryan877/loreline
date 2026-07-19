import { Effect } from "effect";
import {
  webSearchInputSchema,
  webSearchResponseSchema,
} from "@loreline/contracts/ai";
import { searchTavily } from "@/modules/ai/providers/tavily";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/platform/http";
import { AppConfigTag } from "@/platform/config";
import { runServerEffect } from "@/platform/services";

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    await assertRateLimit(`web-search:${session.user.id}`, 30, 60 * 60 * 1000);
    const input = webSearchInputSchema.parse(await request.json());
    const results = await runServerEffect(
      Effect.gen(function* () {
        const { tavilyApiKey } = yield* AppConfigTag;
        if (!tavilyApiKey)
          return yield* Effect.fail(
            new HttpError(503, "Web search is not available yet."),
          );
        return yield* Effect.tryPromise(() =>
          searchTavily(input.query, { apiKey: tavilyApiKey }),
        );
      }),
    );
    return Response.json(webSearchResponseSchema.parse({ results }));
  } catch (error) {
    return apiError(error);
  }
}
