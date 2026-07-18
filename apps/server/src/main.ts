import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { HttpMiddleware, HttpServer } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { config as loadEnv } from "dotenv";
import { Layer } from "effect";

loadEnv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const { ApiRouter } = await import("@/api/router");
const { BookIndexWorkerLive } = await import(
  "@/modules/books/index-queue"
);
const { AppRuntimeLive } = await import("@/platform/services");
const port = Number(process.env.PORT ?? 3_001);

const HttpLive = HttpServer.serve(ApiRouter, HttpMiddleware.logger).pipe(
  HttpServer.withLogAddress,
  Layer.provide(
    NodeHttpServer.layer(createServer, { host: "0.0.0.0", port }),
  ),
);

Layer.launch(
  Layer.mergeAll(HttpLive, BookIndexWorkerLive, AppRuntimeLive),
).pipe(
  NodeRuntime.runMain,
);
