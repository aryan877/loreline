import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { and, eq, gt, lt, or } from "drizzle-orm";
import { Data, Effect, Layer } from "effect";
import { books } from "@loreline/database/schema";
import { indexBook } from "@/modules/books/indexing";
import { getRedis } from "@/platform/redis";
import { DatabaseService, runServerEffect } from "@/platform/services";

const INDEX_STREAM = "loreline:book-index";
const INDEX_GROUP = "loreline-indexers";
const INDEXING_LEASE_MS = 15 * 60 * 1_000;
const RECONNECT_DELAY_MS = 2_000;
const STREAM_MAX_LENGTH = 10_000;

interface BookIndexJob {
  readonly bookId: string;
  readonly userId: string;
}

export class BookIndexWorkerError extends Data.TaggedError(
  "BookIndexWorkerError",
)<{ readonly cause: unknown }> {}

function isBusyGroupError(error: unknown) {
  return error instanceof Error && error.message.includes("BUSYGROUP");
}

function parseJob(message: Record<string, string>): BookIndexJob | undefined {
  const { bookId, userId } = message;
  return bookId && userId ? { bookId, userId } : undefined;
}

function waitForRetry(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(resolve, RECONNECT_DELAY_MS);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

export async function enqueueBookIndex({ bookId, userId }: BookIndexJob) {
  const redis = await getRedis();
  await redis.xAdd(
    INDEX_STREAM,
    "*",
    { bookId, userId },
    {
      TRIM: {
        strategy: "MAXLEN",
        strategyModifier: "~",
        threshold: STREAM_MAX_LENGTH,
      },
    },
  );
}

async function recoverDatabaseJobs() {
  const staleBefore = new Date(Date.now() - INDEXING_LEASE_MS);
  const jobs = await runServerEffect(
    Effect.gen(function* () {
      const { db } = yield* DatabaseService;
      return yield* Effect.tryPromise(() =>
        db
          .select({ bookId: books.id, userId: books.userId })
          .from(books)
          .where(
            and(
              eq(books.status, "ready"),
              gt(books.totalChunks, 0),
              or(
                eq(books.indexingStatus, "pending"),
                and(
                  eq(books.indexingStatus, "indexing"),
                  lt(books.indexingUpdatedAt, staleBefore),
                ),
              ),
            ),
          )
          .limit(1_000),
      );
    }),
  );
  await Promise.all(jobs.map(enqueueBookIndex));
}

async function runBookIndexWorker(signal: AbortSignal) {
  const consumer = `${hostname()}:${process.pid}:${randomUUID()}`;
  while (!signal.aborted) {
    const redis = (await getRedis()).duplicate();
    const stop = () => redis.destroy();
    signal.addEventListener("abort", stop, { once: true });
    try {
      await redis.connect();
      try {
        await redis.xGroupCreate(INDEX_STREAM, INDEX_GROUP, "0", {
          MKSTREAM: true,
        });
      } catch (error) {
        if (!isBusyGroupError(error)) throw error;
      }
      await recoverDatabaseJobs();

      while (!signal.aborted) {
        const claimed = await redis.xAutoClaim(
          INDEX_STREAM,
          INDEX_GROUP,
          consumer,
          INDEXING_LEASE_MS,
          "0-0",
          { COUNT: 10 },
        );
        const fresh = await redis.xReadGroup(
          INDEX_GROUP,
          consumer,
          { key: INDEX_STREAM, id: ">" },
          { COUNT: 1, BLOCK: claimed.messages.length ? 1 : 5_000 },
        );
        const messages = [
          ...claimed.messages.filter((message) => message !== null),
          ...(fresh?.flatMap((stream) => stream.messages) ?? []),
        ];

        for (const message of messages) {
          const job = parseJob(message.message);
          if (job) await indexBook(job.bookId, job.userId);
          else
            console.error("Loreline discarded an invalid index job", {
              id: message.id,
            });
          await redis
            .multi()
            .xAck(INDEX_STREAM, INDEX_GROUP, message.id)
            .xDel(INDEX_STREAM, message.id)
            .exec();
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        console.error("Loreline index worker disconnected", error);
        await waitForRetry(signal);
      }
    } finally {
      signal.removeEventListener("abort", stop);
      if (redis.isOpen) redis.destroy();
    }
  }
}

export const BookIndexWorkerLive = Layer.scopedDiscard(
  Effect.forkScoped(
    Effect.tryPromise({
      try: (signal) => runBookIndexWorker(signal),
      catch: (cause) => new BookIndexWorkerError({ cause }),
    }).pipe(Effect.orDie),
  ).pipe(Effect.asVoid),
);
