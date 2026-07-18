import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { getRedis } from "@/platform/redis";
import {
  DatabaseService,
  runServerEffect,
  StorageService,
} from "@/platform/services";

export async function GET() {
  try {
    const storage = await runServerEffect(
      Effect.gen(function* () {
        const { db } = yield* DatabaseService;
        yield* Effect.tryPromise(() => db.execute(sql`select 1`));
        const objectStorage = yield* StorageService;
        yield* objectStorage.check();
        return "r2";
      }),
    );
    const redis = await getRedis();
    await redis.ping();
    return Response.json({
      status: "ok",
      postgres: "ok",
      redis: "ok",
      storage,
    });
  } catch {
    return Response.json({ status: "degraded" }, { status: 503 });
  }
}
