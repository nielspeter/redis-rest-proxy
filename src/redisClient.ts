import Redis from 'ioredis';
import { z } from 'zod';

// Add Zod schemas for configuration validation
const RedisConfigSchema = z.object({
  // Single-instance mode
  REDIS_HOST: z.string().optional().default('localhost'),
  REDIS_PORT: z.string().optional().default('6379'),
  REDIS_DB: z.string().optional().default('0'),
  REDIS_PASSWORD: z.string().optional(),

  // Sentinel mode
  REDIS_SENTINELS: z.string().optional(),
  REDIS_MASTER_NAME: z.string().optional().default('mymaster'),
  REDIS_MASTER_PASSWORD: z.string().optional(),
  REDIS_SENTINEL_PASSWORD: z.string().optional(),

  // Optional features
  REDIS_ENABLE_AUTO_PIPELINING: z.enum(['true', 'false']).optional(),
});

// The singleton Redis client instance.
let redis: Redis | undefined;

/**
 * Returns the singleton Redis client.
 * If no client exists, it creates one based on environment variables.
 */
export function getRedis(): Redis {
  if (!redis) {
    // Validate configuration
    const config = RedisConfigSchema.parse(Bun.env);

    // Check if Sentinel mode is enabled.
    if (config.REDIS_SENTINELS) {
      console.info(`Creating Redis client in Sentinel mode with ${config.REDIS_SENTINELS.split(',').length} sentinels`);
      const sentinels = config.REDIS_SENTINELS.split(',').map((s) => {
        const [host, port] = s.split(':');
        if (!host || !port || isNaN(parseInt(port, 10))) {
          throw new Error(`Invalid sentinel configuration: ${s}. Expected format: host:port`);
        }
        return { host, port: parseInt(port, 10) };
      });

      const db = parseInt(config.REDIS_DB || '0', 10);
      redis = new Redis({
        sentinels,
        name: config.REDIS_MASTER_NAME,
        password: config.REDIS_MASTER_PASSWORD,
        sentinelPassword: config.REDIS_SENTINEL_PASSWORD,
        db: isNaN(db) ? 0 : db,
        enableAutoPipelining: config.REDIS_ENABLE_AUTO_PIPELINING === 'true',
      });
    } else {
      // Single-instance mode.
      console.info(
        `Creating Redis client in single-instance mode with host: ${config.REDIS_HOST}, port: ${config.REDIS_PORT}`
      );
      const db = parseInt(config.REDIS_DB || '0', 10);
      redis = new Redis({
        host: config.REDIS_HOST || 'localhost',
        port: parseInt(config.REDIS_PORT || '6379', 10),
        db: isNaN(db) ? 0 : db,
        enableAutoPipelining: config.REDIS_ENABLE_AUTO_PIPELINING === 'true',
        password: config.REDIS_PASSWORD,
      });
    }
  }
  return redis;
}

/**
 * Overrides the singleton Redis client.
 * This function is useful in testing to inject a dummy Redis client.
 */
export function setRedis(newClient: Redis) {
  redis = newClient;
}
