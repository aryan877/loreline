import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import {
  DatabaseService,
  runServerEffect,
  StorageService,
} from "@/server/services";

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
    return NextResponse.json({
      status: "ok",
      postgres: "ok",
      redis: "ok",
      storage,
    });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
