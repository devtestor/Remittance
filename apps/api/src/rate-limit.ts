import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

type LocalBucket = { count: number; resetAt: number };

const localBuckets = new Map<string, LocalBucket>();
const redisUrl = process.env.REDIS_URL;
const redisClient = redisUrl ? createClient({ url: redisUrl }) : null;
let redisConnection: Promise<void> | null = null;

if (redisClient) {
  redisClient.on("error", (error) => {
    console.error("Redis rate limiter error", error);
  });
}

export async function consumeRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (redisClient) {
    try {
      await connectRedis(redisClient);
      const redisKey = `velo:rate-limit:${input.key}`;
      const count = await redisClient.incr(redisKey);
      if (count === 1) {
        await redisClient.pExpire(redisKey, input.windowMs);
      }
      const ttl = await redisClient.pTTL(redisKey);
      return {
        allowed: count <= input.limit,
        retryAfterSeconds: Math.max(1, Math.ceil(Math.max(ttl, 0) / 1000))
      };
    } catch (error) {
      console.error("Redis unavailable; using local rate limiter", error);
    }
  }

  return consumeLocalRateLimit(input);
}

async function connectRedis(client: RedisClient): Promise<void> {
  if (client.isReady) return;
  redisConnection ??= client.connect().then(() => undefined);
  await redisConnection;
}

function consumeLocalRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const current = localBuckets.get(input.key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + input.windowMs }
    : current;
  bucket.count += 1;
  localBuckets.set(input.key, bucket);

  return {
    allowed: bucket.count <= input.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  };
}
