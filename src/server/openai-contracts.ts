import type { ImageGenerateParamsNonStreaming } from "openai/resources/images";
import type {
  ClientSecretCreateParams,
  ClientSecretCreateResponse,
} from "openai/resources/realtime/client-secrets";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseInputContent,
} from "openai/resources/responses/responses";

export interface ChatModelClient {
  responses: {
    create: (
      params: ResponseCreateParamsNonStreaming,
    ) => Promise<{ output_text: string }>;
  };
}

export interface ImageModelClient {
  images: {
    generate: (
      params: ImageGenerateParamsNonStreaming,
    ) => Promise<{ data?: Array<{ b64_json?: string }> }>;
  };
}

export interface RealtimeModelClient {
  realtime: {
    clientSecrets: {
      create: (
        params: ClientSecretCreateParams,
      ) => Promise<ClientSecretCreateResponse>;
    };
  };
}

export function needsSecondaryBookContext(
  question: string,
  visibleText: string,
) {
  return (
    visibleText.trim().length < 100 ||
    /\b(elsewhere|earlier|later|whole book|chapter|overall|compare|theme|throughout|author's view|author’s view)\b/i.test(
      question,
    )
  );
}

export async function callChatModel(
  client: ChatModelClient,
  input: { model: string; prompt: string; screenshot?: string },
) {
  const content: ResponseInputContent[] = [
    { type: "input_text", text: input.prompt },
  ];
  if (input.screenshot?.startsWith("data:image/")) {
    content.push({
      type: "input_image",
      image_url: input.screenshot,
      detail: "low",
    });
  }
  return client.responses.create({
    model: input.model,
    input: [{ role: "user", content }],
  });
}

export async function callImageModel(
  client: ImageModelClient,
  input: { model: string; prompt: string },
) {
  return client.images.generate({
    model: input.model,
    quality: "low",
    size: "1024x1024",
    output_format: "webp",
    output_compression: 72,
    n: 1,
    prompt: input.prompt,
  });
}

export async function mintRealtimeClientSecret(
  client: RealtimeModelClient,
  input: { model: string; bookTitle?: string },
) {
  return client.realtime.clientSecrets.create({
    expires_after: { anchor: "created_at", seconds: 600 },
    session: {
      type: "realtime",
      model: input.model,
      instructions: `You are Loreline, a calm, perceptive reading companion${input.bookTitle ? ` helping with “${input.bookTitle}”` : ""}. The current visible page, selection, and pointer context are primary truth. Use retrieved context only as secondary support. Speak conversationally, keep answers compact, and never pretend to see a passage that was not provided.`,
      audio: { output: { voice: "marin" } },
    },
  });
}
