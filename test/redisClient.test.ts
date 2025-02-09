import { test, expect, beforeEach, afterEach } from 'bun:test';
import { getRedis, setRedis } from '../src/redisClient.ts';
import Redis from 'ioredis';

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = { ...Bun.env };
  setRedis(undefined as any);
});

afterEach(() => {
  for (const key in Bun.env) {
    delete Bun.env[key];
  }
  for (const key in originalEnv) {
    if (originalEnv[key] !== undefined) {
      Bun.env[key] = originalEnv[key];
    }
  }
});

test('getRedis returns single-instance mode configuration', () => {
  Bun.env.REDIS_HOST = 'test-host';
  Bun.env.REDIS_PORT = '6379';

  const client = getRedis();
  expect(client).toBeInstanceOf(Redis);
  expect(client.options.sentinels).toBeNull();
  expect(client.options.host).toBe('test-host');

  client.disconnect();
});

test('getRedis returns Sentinel mode configuration', () => {
  Bun.env.REDIS_SENTINELS = '127.0.0.1:26379,192.168.1.100:26379';
  Bun.env.REDIS_MASTER_NAME = 'mymaster';

  const client = getRedis();
  expect(client).toBeInstanceOf(Redis);
  expect(Array.isArray(client.options.sentinels)).toBe(true);
  expect(client.options.sentinels).toHaveLength(2);
  expect(client.options.sentinels![0]).toEqual({
    host: '127.0.0.1',
    port: 26379,
  });
  expect(client.options.sentinels![1]).toEqual({
    host: '192.168.1.100',
    port: 26379,
  });
  expect(client.options.name).toBe('mymaster');

  client.disconnect();
});

test('getRedis validates sentinel configuration format', () => {
  Bun.env.REDIS_SENTINELS = 'invalid-format';
  Bun.env.REDIS_MASTER_NAME = 'mymaster';

  expect(() => getRedis()).toThrow('Invalid sentinel configuration');
});

test('getRedis configures optional features correctly', () => {
  Bun.env.REDIS_HOST = 'test-host';
  Bun.env.REDIS_PORT = '6379';
  Bun.env.REDIS_ENABLE_AUTO_PIPELINING = 'true';
  Bun.env.REDIS_DB = '2';

  const client = getRedis();
  expect(client.options.enableAutoPipelining).toBe(true);
  expect(client.options.db).toBe(2);

  client.disconnect();
});

test('setRedis allows overriding the Redis client', () => {
  const mockClient = {
    disconnect: () => {},
    options: {},
  } as Redis;

  setRedis(mockClient);
  expect(getRedis()).toBe(mockClient);
});

test('getRedis uses default values when no environment variables are set', () => {
  const client = getRedis();
  expect(client.options.host).toBe('localhost');
  expect(client.options.port).toBe(6379);
  expect(client.options.db).toBe(0);

  client.disconnect();
});

test('getRedis configures sentinel passwords correctly', () => {
  Bun.env.REDIS_SENTINELS = '127.0.0.1:26379';
  Bun.env.REDIS_MASTER_NAME = 'mymaster';
  Bun.env.REDIS_MASTER_PASSWORD = 'masterpass';
  Bun.env.REDIS_SENTINEL_PASSWORD = 'sentinelpass';

  const client = getRedis();
  expect(client.options.password).toBe('masterpass');
  expect(client.options.sentinelPassword).toBe('sentinelpass');

  client.disconnect();
});
