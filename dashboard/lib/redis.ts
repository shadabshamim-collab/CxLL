import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redis: Redis | null = null;
let redisAvailable: boolean | null = null;

export function getRedis(): Redis {
    if (!redis) {
        redis = new Redis(REDIS_URL, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            lazyConnect: true,
            retryStrategy(times) {
                if (times > 3) {
                    redisAvailable = false;
                    return null; // stop retrying
                }
                return Math.min(times * 500, 3000);
            },
        });
        redis.on('error', () => {
            redisAvailable = false;
        });
        redis.on('connect', () => {
            redisAvailable = true;
        });
    }
    return redis;
}

export function createRedisConnection(): Redis {
    return new Redis(REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
        retryStrategy(times) {
            if (times > 3) return null;
            return Math.min(times * 500, 3000);
        },
    });
}

export async function isRedisHealthy(): Promise<boolean> {
    if (redisAvailable === false) return false;
    try {
        const r = getRedis();
        if (r.status !== 'ready') {
            await r.connect().catch(() => {});
        }
        if (r.status !== 'ready') return false;
        const pong = await Promise.race([
            r.ping(),
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]);
        return pong === 'PONG';
    } catch {
        redisAvailable = false;
        return false;
    }
}

export function isRedisAvailable(): boolean {
    return redisAvailable === true;
}
