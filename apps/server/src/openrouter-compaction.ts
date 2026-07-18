import "server-only";

import { z } from "zod";
import {
  realtimeMemorySchema,
  type RealtimeCompactionInput,
  type RealtimeMemory,
} from "@loreline/contracts/ai";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const openRouterResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().min(1) }),
    }),
  ),
});

export async function compactRealtimeConversation(
  input: RealtimeCompactionInput,
  options: {
    apiKey: string;
    model: string;
    fetch?: typeof fetch;
  },
): Promise<RealtimeMemory> {
  const request = options.fetch ?? fetch;
  const response = await request(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://loreline.app",
      "X-Title": "Loreline",
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: "system",
          content:
            "Compress a voice conversation between a reader and a reading companion. Preserve reader goals, page references, explanations, decisions, preferences, unresolved questions, and any notes or visuals they asked to save. Merge the previous memory with the new turns. Do not invent facts. Keep the result compact enough to serve as future conversation memory.",
        },
        {
          role: "user",
          content: JSON.stringify({
            currentPage: input.page,
            previousMemory: input.previousMemory ?? null,
            newTurns: input.turns,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "loreline_realtime_memory",
          strict: true,
          schema: z.toJSONSchema(realtimeMemorySchema, {
            target: "draft-7",
          }),
        },
      },
      provider: {
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      },
      reasoning: { effort: "none", exclude: true },
      temperature: 0.1,
      max_tokens: 4_000,
      stream: false,
    }),
  });

  if (!response.ok)
    throw new Error(`OpenRouter compaction failed with ${response.status}.`);

  const payload = openRouterResponseSchema.parse(await response.json());
  const content = payload.choices[0]?.message.content;
  if (!content) throw new Error("OpenRouter returned no compaction output.");
  return realtimeMemorySchema.parse(JSON.parse(content));
}
