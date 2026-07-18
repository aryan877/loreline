import { z } from "zod";
import {
  realtimeMemorySchema,
  type RealtimeCompactionInput,
  type RealtimeMemory,
} from "@loreline/contracts/ai";
import {
  type OpenRouterOptions,
  postOpenRouter,
} from "@/modules/ai/providers/openrouter";

const openRouterResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().min(1) }),
    }),
  ),
});

export async function compactRealtimeConversation(
  input: RealtimeCompactionInput,
  options: OpenRouterOptions,
): Promise<RealtimeMemory> {
  const payload = openRouterResponseSchema.parse(
    await postOpenRouter(
      "/chat/completions",
      {
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
      },
      options,
    ),
  );
  const content = payload.choices[0]?.message.content;
  if (!content) throw new Error("OpenRouter returned no compaction output.");
  return realtimeMemorySchema.parse(JSON.parse(content));
}
