import "server-only";

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
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number()).length(BOOK_EMBEDDING_DIMENSIONS),
    }),
  ),
});

type OpenRouterOptions = {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
};

async function postOpenRouter(
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
  });
  if (!response.ok)
    throw new Error(`OpenRouter request failed with ${response.status}.`);
  return response.json();
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
  return payload.data
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);
}
