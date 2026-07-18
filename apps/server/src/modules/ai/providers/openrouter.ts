import { z } from "zod";
import { BOOK_EMBEDDING_DIMENSIONS } from "@loreline/database/schema";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const imageMediaTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);

const imageResponseSchema = z.object({
  data: z
    .array(
      z.object({
        b64_json: z.string().min(1),
        media_type: imageMediaTypeSchema.optional(),
      }),
    )
    .min(1),
  usage: z.object({ cost: z.number().nonnegative().optional() }).optional(),
});

const embeddingResponseSchema = z.object({
  data: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        embedding: z.array(z.number()).length(BOOK_EMBEDDING_DIMENSIONS),
      }),
    )
    .min(1),
});

const openRouterErrorSchema = z.object({
  error: z.union([
    z.string().min(1),
    z.object({
      message: z.string().min(1),
      code: z.union([z.string(), z.number()]).optional(),
    }),
  ]),
});

export type OpenRouterOptions = {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
};

export class OpenRouterRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OpenRouterRequestError";
  }
}

export async function postOpenRouter(
  path: string,
  body: unknown,
  options: OpenRouterOptions,
) {
  const request = options.fetch ?? fetch;
  const response = await request(`${OPENROUTER_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://loreline.app",
      "X-Title": "Loreline",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  const providerError = openRouterErrorSchema.safeParse(payload);
  if (!response.ok || providerError.success) {
    const message = providerError.success
      ? typeof providerError.data.error === "string"
        ? providerError.data.error
        : providerError.data.error.message
      : "The provider returned an unreadable error response.";
    const providerCode =
      providerError.success && typeof providerError.data.error !== "string"
        ? Number(providerError.data.error.code)
        : Number.NaN;
    const status = response.ok
      ? providerCode >= 400 && providerCode <= 599
        ? providerCode
        : 502
      : response.status;
    throw new OpenRouterRequestError(status, message);
  }
  return payload;
}

export async function generateOpenRouterImage(
  prompt: string,
  options: OpenRouterOptions,
) {
  const payload = imageResponseSchema.parse(
    await postOpenRouter(
      "/images",
      {
        model: options.model,
        prompt,
        quality: "low",
        n: 1,
      },
      options,
    ),
  );
  const image = payload.data[0];
  return {
    encoded: image.b64_json,
    mediaType: image.media_type ?? ("image/png" as const),
    costUsd: payload.usage?.cost,
  };
}

export async function createOpenRouterEmbeddings(
  input: string | string[],
  options: OpenRouterOptions,
) {
  const expectedCount = Array.isArray(input) ? input.length : 1;
  if (expectedCount === 0) return [];
  const payload = embeddingResponseSchema.parse(
    await postOpenRouter(
      "/embeddings",
      {
        model: options.model,
        input,
        dimensions: BOOK_EMBEDDING_DIMENSIONS,
        encoding_format: "float",
        provider: {
          allow_fallbacks: true,
          data_collection: "deny",
        },
      },
      options,
    ),
  );
  const ordered = [...payload.data].sort(
    (left, right) => left.index - right.index,
  );
  if (
    ordered.length !== expectedCount ||
    ordered.some((item, index) => item.index !== index)
  ) {
    throw new OpenRouterRequestError(
      502,
      "The embedding provider returned an incomplete batch.",
    );
  }
  return ordered.map((item) => item.embedding);
}
