/**
 * Redis REST Proxy
 *
 * This service uses Bun to serve HTTP requests and ioredis to connect to Redis.
 * It supports three command endpoints:
 *  - Pipeline: POST /pipeline
 *  - Multi‑exec (transaction): POST /multi-exec
 *  - Generic command handler: Any other path as a Redis command
 *
 * Configuration is done via environment variables:
 *  - SERVER_PORT: Port for the proxy (default: 3000)
 *  - AUTH_TOKEN: Token required to authenticate requests.
 *  - For single‑instance mode:
 *      - REDIS_HOST: Redis host (default: localhost)
 *      - REDIS_PORT: Redis port (default: 6379)
 *      - REDIS_DB: Redis database index (default: 0)
 *      - REDIS_PASSWORD: Password for the Redis instance.
 *  - For Sentinel mode:
 *      - REDIS_SENTINELS: Comma‑separated list of host:port (e.g., "host1:26379,host2:26379")
 *      - REDIS_MASTER_NAME: Name of the master (default: "mymaster")
 *      - REDIS_MASTER_PASSWORD: Password for the master.
 *      - REDIS_SENTINEL_PASSWORD: Password for the sentinels (if needed)
 *  - REDIS_ENABLE_AUTO_PIPELINING: Set to "true" to enable auto‑pipelining.
 */

import { Buffer } from 'buffer';
import { serve } from 'bun';
import { z } from 'zod';
import { getRedis } from './redisClient.ts';

// Group related constants
const CONSTANTS = {
  DEFAULT_PORT: 3000,
  DEFAULT_TOKEN: 'MY_SUPER_SECRET_TOKEN',
  HEADERS: {
    UPSTASH_ENCODING: 'Upstash-Encoding',
  },
} as const;

// --- Environment Configuration ---
const envSchema = z.object({
  SERVER_PORT: z.preprocess((val) => parseInt(String(val || CONSTANTS.DEFAULT_PORT), 10), z.number().min(1).max(65535)),
  AUTH_TOKEN: z.string().min(1).default(CONSTANTS.DEFAULT_TOKEN),
});
const env = envSchema.parse(Bun.env);

// --- Helper Functions ---

/**
 * Checks the incoming request for proper authentication.
 * Supports the "Bearer" token in the Authorization header or a _token query parameter.
 */
export async function checkAuth(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('Authorization') || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }
  // Also check the URL query parameter _token
  const url = new URL(request.url);
  if (!token && url.searchParams.has('_token')) {
    token = url.searchParams.get('_token') as string;
  }
  return token === env.AUTH_TOKEN;
}

/**
 * Encodes strings to Base64 if needed.
 */
export function encodeToBase64(value: any): any {
  if (typeof value === 'string' && value !== 'OK') {
    return Buffer.from(value, 'utf8').toString('base64');
  }
  if (Array.isArray(value)) {
    return value.map((el) => encodeToBase64(el));
  }
  if (value !== null && typeof value === 'object') {
    const encodedObj: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      encodedObj[key] = encodeToBase64(val);
    }
    return encodedObj;
  }
  return value;
}

// Add type definitions for Redis responses
type RedisResponse = string | number | boolean | null | Buffer | RedisResponse[];

/**
 * Formats the Redis response.
 */
export function formatRedisResponse(reply: any, request: Request): RedisResponse {
  const upstashEncoding = request.headers.get(CONSTANTS.HEADERS.UPSTASH_ENCODING)?.toLowerCase();

  // Convert object responses (e.g., from HGETALL) to arrays.
  if (typeof reply === 'object' && reply !== null && !Array.isArray(reply)) {
    reply = Object.entries(reply).flat();
  }

  const encodeBase64 = upstashEncoding === 'base64';
  reply = encodeBase64 ? encodeToBase64(reply) : reply;

  return reply;
}

/**
 * Returns a JSON response with the given body and status.
 */
export function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- Command Builders ---

// Zod schema for a generic (flat) command: must be an array where the first element is a string.
const genericCommandSchema = z
  .array(z.union([z.string(), z.number()]))
  .refine((arr) => arr.length > 0 && typeof arr[0] === 'string', {
    message: 'The first element must be the command name (a string).',
  });

/**
 * Builds a Redis command and its arguments from the incoming HTTP request.
 * If the request body is a JSON array, it is used directly.
 * If the request body is not an array, the URL path segments are used.
 * Additionally, if the JSON body is an array of arrays (e.g., batch commands), an error is thrown.
 */
export async function buildCommand(
  request: Request,
  pathname: string
): Promise<{ command: string; args: Array<string> }> {
  // Attempt to read the request body as text.
  let text: string;
  try {
    text = await request.text();
  } catch (err) {
    text = '';
  }

  // Get URL query parameters (except _token) upfront
  const url = new URL(request.url);
  const queryArgs: string[] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (key === '_token') continue;
    queryArgs.push(key, value);
  }

  // If we have a non-empty body and the method is POST, try parsing it as JSON.
  let bodyParsed: any = null;
  if (request.method === 'POST' && text.trim() !== '') {
    try {
      bodyParsed = JSON.parse(text);
    } catch (jsonErr: any) {
      console.error('Failed to parse request body as JSON:', jsonErr);
      throw new Error('Unable to parse request body as JSON.');
    }
  }

  // If a JSON array was provided, treat it as the generic command.
  if (bodyParsed !== null) {
    if (Array.isArray(bodyParsed)) {
      // Reject an array-of-arrays.
      if (bodyParsed.length > 0 && Array.isArray(bodyParsed[0])) {
        throw new Error(
          'Expected a flat JSON array for a single command. For batch commands, please use /pipeline or /multi-exec.'
        );
      }
      try {
        const validated = genericCommandSchema.parse(bodyParsed);
        const [cmd, ...args] = validated;
        return {
          command: String(cmd),
          args: [...args.map(String), ...queryArgs],
        };
      } catch (err: any) {
        throw new Error(err.message);
      }
    }
  }

  // Otherwise, use URL path segments.
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('No command provided in URL.');
  }
  const command = segments[0];
  const args: Array<string> = [...segments.slice(1).map(String), ...queryArgs];

  return { command, args };
}

// --- Batch Command Execution ---

// Zod schema for a batch of command arrays.
const batchCommandSchema = z.array(z.array(z.union([z.string(), z.number()])));

/**
 * Executes a batch of Redis commands in either pipeline or multi‑exec mode.
 * Each inner array is expected to be of the form [command, arg1, arg2, ...].
 */
export async function executeBatchCommands(commands: (string | number)[][], mode: 'pipeline' | 'multi') {
  const executor = mode === 'pipeline' ? getRedis().pipeline() : getRedis().multi();
  for (const commandArr of commands) {
    if (!Array.isArray(commandArr) || commandArr.length === 0) {
      throw new Error('Each command must be a non‑empty array');
    }
    const [cmd, ...args] = commandArr;
    executor.call(String(cmd), args.map(String));
  }
  const results = await executor.exec();
  if (!results) {
    throw new Error(`${mode === 'pipeline' ? 'Pipeline' : 'Transaction'} failed`);
  }
  return results;
}

/**
 * Handles batch commands (pipeline or multi‑exec) from the request.
 */
export async function handleBatchCommands(request: Request, mode: 'pipeline' | 'multi'): Promise<Response> {
  let body: (string | number)[][];
  try {
    body = batchCommandSchema.parse(await request.json());
  } catch (err: any) {
    console.error(`${mode}: Malformed JSON input`, {
      error: err.message,
    });
    return jsonResponse({ error: 'Expected a JSON array of command arrays' }, 400);
  }
  try {
    const results = await executeBatchCommands(body, mode);
    const response = results.map(([err, result]) =>
      err ? { error: err.message } : { result: formatRedisResponse(result, request) }
    );
    return jsonResponse(response);
  } catch (err: any) {
    console.error(`${mode} execution error:`, {
      error: err.message,
    });
    return jsonResponse({ error: err.message }, 400);
  }
}

// --- Main Request Handler ---

/**
 * Main request handler for the Bun server.
 * Routes requests to:
 *  - /pipeline: Executes a batch of commands via Redis pipelining.
 *  - /multi-exec: Executes a batch of commands via Redis multi‑exec (transactions).
 *  - Generic commands: Uses the URL path and/or body as a single Redis command.
 */
export async function handler(request: Request): Promise<Response> {
  // Parse URL to determine endpoint.
  const { pathname } = new URL(request.url);

  // Add health check endpoint
  if (pathname === '/health') {
    return jsonResponse({ status: 'healthy', redis: await getRedis().ping() });
  }

  // Authenticate the request.
  if (!(await checkAuth(request))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // Pipeline Endpoint.
  if (pathname === '/pipeline' && request.method === 'POST') {
    return handleBatchCommands(request, 'pipeline');
  }

  // Multi‑exec (transaction) Endpoint.
  if (pathname === '/multi-exec' && request.method === 'POST') {
    return handleBatchCommands(request, 'multi');
  }

  // Generic Command Handler.
  try {
    const { command, args } = await buildCommand(request, pathname);
    const reply = await getRedis().call(command, ...args);
    return jsonResponse({ result: formatRedisResponse(reply, request) });
  } catch (err: any) {
    console.error('Generic command error:', {
      error: err.message,
    });
    return jsonResponse({ error: err.message }, 400);
  }
}

// --- Main Server Setup ---

getRedis(); // Initialize the Redis client.

console.log(`Redis REST proxy listening on port ${env.SERVER_PORT}`);
const server = serve({
  port: env.SERVER_PORT,
  fetch: handler,
  idleTimeout: 0, // Disable timeout (useful for long-lived connections)
});

// Add graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  await getRedis().quit();
  await server.stop();
});
