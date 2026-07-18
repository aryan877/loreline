import { Config, Context, Effect, Layer, Option } from "effect";

export interface AppConfig {
  readonly openAiApiKey?: string;
  readonly openRouterApiKey?: string;
  readonly compactionModel: string;
  readonly realtimeModel: string;
  readonly openRouterImageModel: string;
  readonly openRouterEmbeddingModel: string;
  readonly r2AccountId: string;
  readonly r2AccessKeyId: string;
  readonly r2SecretAccessKey: string;
  readonly r2BucketName: string;
}

export class AppConfigTag extends Context.Tag("Loreline/AppConfig")<
  AppConfigTag,
  AppConfig
>() {}

const optional = (name: string) =>
  Config.option(Config.string(name)).pipe(
    Config.map(Option.getOrUndefined),
    Config.map((value) => value?.trim() || undefined),
  );

export const AppConfigLive = Layer.effect(
  AppConfigTag,
  Effect.gen(function* () {
    return {
      openAiApiKey: yield* optional("OPENAI_API_KEY"),
      openRouterApiKey: yield* optional("OPENROUTER_API_KEY"),
      compactionModel: yield* Config.string("OPENROUTER_COMPACTION_MODEL").pipe(
        Config.withDefault("deepseek/deepseek-v4-flash"),
      ),
      realtimeModel: yield* Config.string("OPENAI_REALTIME_MODEL").pipe(
        Config.withDefault("gpt-realtime-2.1-mini"),
      ),
      openRouterImageModel: yield* Config.string("OPENROUTER_IMAGE_MODEL").pipe(
        Config.withDefault("openai/gpt-image-1-mini"),
      ),
      openRouterEmbeddingModel: yield* Config.string(
        "OPENROUTER_EMBEDDING_MODEL",
      ).pipe(Config.withDefault("openai/text-embedding-3-small")),
      r2AccountId: yield* Config.string("R2_ACCOUNT_ID"),
      r2AccessKeyId: yield* Config.string("R2_ACCESS_KEY_ID"),
      r2SecretAccessKey: yield* Config.string("R2_SECRET_ACCESS_KEY"),
      r2BucketName: yield* Config.string("R2_BUCKET_NAME").pipe(
        Config.withDefault("loreline-books"),
      ),
    } satisfies AppConfig;
  }),
);
