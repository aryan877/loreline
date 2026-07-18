import type {
  ClientSecretCreateParams,
  ClientSecretCreateResponse,
} from "openai/resources/realtime/client-secrets";

export interface RealtimeModelClient {
  realtime: {
    clientSecrets: {
      create: (
        params: ClientSecretCreateParams,
      ) => Promise<ClientSecretCreateResponse>;
    };
  };
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
