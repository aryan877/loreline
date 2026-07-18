import { ZodError } from "zod";
import { Cause, Option, Runtime } from "effect";
import { auth } from "@/modules/auth/service";
import { getRedis } from "@/platform/redis";

export async function requireSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "Please sign in to continue.");
  return session;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiError(error: unknown) {
  if (Runtime.isFiberFailure(error)) {
    const failure = Cause.failureOption(error[Runtime.FiberFailureCauseId]);
    if (Option.isSome(failure)) return apiError(failure.value);
    const defect = Cause.dieOption(error[Runtime.FiberFailureCauseId]);
    if (Option.isSome(defect)) return apiError(defect.value);
  }
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.message },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: "Some of the submitted information is invalid." },
      { status: 400 },
    );
  }
  console.error("Loreline API error", error);
  return Response.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export async function assertRateLimit(
  key: string,
  limit: number,
  windowMs: number,
) {
  try {
    const redis = await getRedis();
    const redisKey = `ratelimit:${key}`;
    const result = (await redis.eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
       return {count, redis.call('PTTL', KEYS[1])}`,
      { keys: [redisKey], arguments: [String(windowMs)] },
    )) as [number, number];
    if (Number(result[0]) > limit)
      throw new HttpError(429, "Too many requests. Try again shortly.");
    return;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (process.env.NODE_ENV === "production") {
      console.error("Rate limiter unavailable", error);
      throw new HttpError(
        503,
        "Service is briefly unavailable. Please try again.",
      );
    }
  }

  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now)
    return void buckets.set(key, { count: 1, resetAt: now + windowMs });
  if (current.count >= limit)
    throw new HttpError(429, "Too many requests. Try again shortly.");
  current.count++;
}
