import { createClient, type RedisClientType } from "redis";

const globalForRedis = globalThis as unknown as {
  lorelineRedis?: RedisClientType;
  lorelineRedisConnection?: Promise<RedisClientType>;
};

export async function getRedis() {
  if (globalForRedis.lorelineRedis?.isReady)
    return globalForRedis.lorelineRedis;
  if (!globalForRedis.lorelineRedisConnection) {
    const client = createClient({
      url: process.env.REDIS_URL ?? "redis://localhost:6379",
    });
    client.on("error", (error) => console.error("Loreline Redis error", error));
    globalForRedis.lorelineRedis = client;
    globalForRedis.lorelineRedisConnection = client
      .connect()
      .then(() => client);
  }
  return globalForRedis.lorelineRedisConnection;
}

export const redisSecondaryStorage = {
  get: async (key: string) => (await getRedis()).get(`auth:${key}`),
  set: async (key: string, value: string, ttl?: number) => {
    const redis = await getRedis();
    if (ttl) await redis.set(`auth:${key}`, value, { EX: ttl });
    else await redis.set(`auth:${key}`, value);
  },
  delete: async (key: string) => {
    await (await getRedis()).del(`auth:${key}`);
  },
  increment: async (key: string, ttl?: number) => {
    const redis = await getRedis();
    const namespaced = `auth:${key}`;
    const result = await redis
      .multi()
      .incr(namespaced)
      .expire(namespaced, ttl ?? 60, "NX")
      .exec();
    return Number(result[0]);
  },
};
