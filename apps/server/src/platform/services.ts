import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Context, Data, Effect, Layer, ManagedRuntime } from "effect";
import OpenAI from "openai";
import { db } from "@loreline/database/client";
import { AppConfigLive, AppConfigTag } from "@/platform/config";
import { retryTransientStorage } from "@/platform/storage-retry";

export class ServiceError extends Data.TaggedError("ServiceError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export class DatabaseService extends Context.Tag("Loreline/Database")<
  DatabaseService,
  { readonly db: typeof db }
>() {}

export const DatabaseLive = Layer.succeed(DatabaseService, { db });

export class StorageService extends Context.Tag("Loreline/Storage")<
  StorageService,
  {
    readonly put: (
      key: string,
      body: Uint8Array,
      contentType: string,
    ) => Effect.Effect<void, ServiceError>;
    readonly get: (key: string) => Effect.Effect<Uint8Array, ServiceError>;
    readonly deletePrefix: (
      prefix: string,
    ) => Effect.Effect<void, ServiceError>;
    readonly deleteObject: (
      key: string,
    ) => Effect.Effect<void, ServiceError>;
    readonly createUploadUrl: (
      key: string,
      size: number,
      contentType: string,
    ) => Effect.Effect<string, ServiceError>;
    readonly check: () => Effect.Effect<void, ServiceError>;
  }
>() {}

export const StorageLive = Layer.effect(
  StorageService,
  Effect.gen(function* () {
    const config = yield* AppConfigTag;
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });
    return {
      put: (key: string, body: Uint8Array, contentType: string) =>
        Effect.tryPromise({
          try: () =>
            retryTransientStorage(() =>
              client.send(
                new PutObjectCommand({
                  Bucket: config.r2BucketName,
                  Key: key,
                  Body: body,
                  ContentType: contentType,
                }),
              ),
            ).then(() => undefined),
          catch: (cause) => new ServiceError({ operation: "r2.put", cause }),
        }),
      get: (key: string) =>
        Effect.tryPromise({
          try: async () => {
            const result = await client.send(
              new GetObjectCommand({
                Bucket: config.r2BucketName,
                Key: key,
              }),
            );
            if (!result.Body) throw new Error("R2 returned an empty object");
            return new Uint8Array(await result.Body.transformToByteArray());
          },
          catch: (cause) => new ServiceError({ operation: "r2.get", cause }),
        }),
      deletePrefix: (prefix: string) =>
        Effect.tryPromise({
          try: async () => {
            while (true) {
              const page = await client.send(
                new ListObjectsV2Command({
                  Bucket: config.r2BucketName,
                  Prefix: prefix,
                  MaxKeys: 1_000,
                }),
              );
              const objects = (page.Contents ?? []).flatMap(({ Key }) =>
                Key ? [{ Key }] : [],
              );
              if (objects.length === 0) return;
              const deleted = await client.send(
                new DeleteObjectsCommand({
                  Bucket: config.r2BucketName,
                  Delete: { Objects: objects, Quiet: true },
                }),
              );
              if (deleted.Errors?.length)
                throw new Error("R2 reported an incomplete prefix deletion.");
            }
          },
          catch: (cause) =>
            new ServiceError({ operation: "r2.deletePrefix", cause }),
        }),
      deleteObject: (key: string) =>
        Effect.tryPromise({
          try: () =>
            client
              .send(
                new DeleteObjectCommand({
                  Bucket: config.r2BucketName,
                  Key: key,
                }),
              )
              .then(() => undefined),
          catch: (cause) =>
            new ServiceError({ operation: "r2.deleteObject", cause }),
        }),
      createUploadUrl: (key: string, size: number, contentType: string) =>
        Effect.tryPromise({
          try: () =>
            getSignedUrl(
              client,
              new PutObjectCommand({
                Bucket: config.r2BucketName,
                Key: key,
                ContentLength: size,
                ContentType: contentType,
              }),
              { expiresIn: 10 * 60 },
            ),
          catch: (cause) =>
            new ServiceError({ operation: "r2.createUploadUrl", cause }),
        }),
      check: () =>
        Effect.tryPromise({
          try: () =>
            client
              .send(
                new ListObjectsV2Command({
                  Bucket: config.r2BucketName,
                  MaxKeys: 1,
                }),
              )
              .then(() => undefined),
          catch: (cause) => new ServiceError({ operation: "r2.check", cause }),
        }),
    };
  }),
);

export class RealtimeService extends Context.Tag("Loreline/Realtime")<
  RealtimeService,
  {
    readonly client?: OpenAI;
    readonly realtimeModel: string;
  }
>() {}

export const RealtimeLive = Layer.effect(
  RealtimeService,
  Effect.gen(function* () {
    const config = yield* AppConfigTag;
    return {
      client: config.openAiApiKey
        ? new OpenAI({ apiKey: config.openAiApiKey })
        : undefined,
      realtimeModel: config.realtimeModel,
    };
  }),
);

const ConfiguredStorage = StorageLive.pipe(Layer.provide(AppConfigLive));
const ConfiguredRealtime = RealtimeLive.pipe(Layer.provide(AppConfigLive));

export const AppLive = Layer.mergeAll(
  AppConfigLive,
  DatabaseLive,
  ConfiguredStorage,
  ConfiguredRealtime,
);

const AppRuntime = ManagedRuntime.make(AppLive);

export const AppRuntimeLive = Layer.scopedDiscard(
  Effect.acquireRelease(
    Effect.succeed(AppRuntime),
    (runtime) => runtime.disposeEffect,
  ).pipe(Effect.asVoid),
);

export const runServerEffect = <A, E>(
  program: Effect.Effect<
    A,
    E,
    DatabaseService | StorageService | RealtimeService | AppConfigTag
  >,
) => AppRuntime.runPromise(program);
