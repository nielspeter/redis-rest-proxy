import { test, expect } from 'bun:test';
import {
  checkAuth,
  encodeToBase64,
  formatResp2,
  formatRedisResponse,
  jsonResponse,
  buildCommand,
  executeBatchCommands,
  handleBatchCommands,
  handler,
} from '../src/server.ts';
import { setRedis } from '../src/redisClient.ts';
import type Redis from 'ioredis';

// --- Dummy Redis Implementation ---
// This dummy Redis client is used by pipeline/multi‑exec and generic calls.
const dummyRedis = {
  // For generic commands.
  call: async (command: string, ...args: string[]) => {
    return `Called: ${command} ${args.join(' ')}`;
  },
  // For pipelining.
  pipeline: () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    return {
      call: (command: string, args: string[]) => {
        calls.push({ command, args });
      },
      exec: async () => {
        return calls.map((call) => [null, `PipelineResult: ${call.command} ${call.args.join(' ')}`]);
      },
    };
  },
  // For multi‑exec (transactions).
  multi: () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    return {
      call: (command: string, args: string[]) => {
        calls.push({ command, args });
      },
      exec: async () => {
        return calls.map((call) => [null, `MultiResult: ${call.command} ${call.args.join(' ')}`]);
      },
    };
  },
};

setRedis(dummyRedis as Redis);

// --- Tests for checkAuth ---
test('checkAuth using Bearer token', async () => {
  const req = new Request('http://localhost/', {
    headers: { Authorization: 'Bearer MY_SUPER_SECRET_TOKEN' },
  });
  const result = await checkAuth(req);
  expect(result).toBe(true);
});

test('checkAuth using query parameter', async () => {
  const req = new Request('http://localhost/?_token=MY_SUPER_SECRET_TOKEN');
  const result = await checkAuth(req);
  expect(result).toBe(true);
});

test('checkAuth fails with invalid token', async () => {
  const req = new Request('http://localhost/', {
    headers: { Authorization: 'Bearer WRONG_TOKEN' },
  });
  const result = await checkAuth(req);
  expect(result).toBe(false);
});

// --- Tests for encodeToBase64 ---
test('encodeToBase64 encodes a string', () => {
  const input = 'Hello';
  const output = encodeToBase64(input);
  expect(output).toBe(Buffer.from('Hello', 'utf8').toString('base64'));
});

test('encodeToBase64 encodes an array', () => {
  const input = ['Hello', 'World'];
  const output = encodeToBase64(input);
  expect(output).toEqual([
    Buffer.from('Hello', 'utf8').toString('base64'),
    Buffer.from('World', 'utf8').toString('base64'),
  ]);
});

test('encodeToBase64 encodes an object', () => {
  const input = { key: 'value' };
  const output = encodeToBase64(input);
  expect(output).toEqual({
    key: Buffer.from('value', 'utf8').toString('base64'),
  });
});

// --- Tests for formatResp2 ---
test('formatResp2 returns null bulk for null', () => {
  const output = formatResp2(null);
  expect(output).toBe('$-1\r\n');
});

test('formatResp2 formats a Buffer', () => {
  const buf = Buffer.from('Hello', 'utf8');
  const output = formatResp2(buf);
  expect(output).toBe(`$${buf.length}\r\nHello\r\n`);
});

test('formatResp2 formats an Error', () => {
  const err = new Error('Test error');
  const output = formatResp2(err);
  expect(output).toBe(`-ERR Test error\r\n`);
});

test('formatResp2 formats booleans', () => {
  expect(formatResp2(true)).toBe(':1\r\n');
  expect(formatResp2(false)).toBe(':0\r\n');
});

test('formatResp2 formats numbers', () => {
  expect(formatResp2(123)).toBe(':123\r\n');
});

test('formatResp2 formats OK string', () => {
  expect(formatResp2('OK')).toBe('+OK\r\n');
});

test('formatResp2 formats regular strings', () => {
  expect(formatResp2('Hello')).toBe('$5\r\nHello\r\n');
});

test('formatResp2 formats arrays recursively', () => {
  const output = formatResp2(['Hello', 'World']);
  expect(output).toBe('*2\r\n$5\r\nHello\r\n$5\r\nWorld\r\n');
});

// --- Tests for formatRedisResponse ---
test('formatRedisResponse returns base64 when header set', () => {
  const req = new Request('http://localhost/', {
    headers: { 'Upstash-Encoding': 'base64' },
  });
  const output = formatRedisResponse('Hello', req);
  expect(output).toBe(Buffer.from('Hello', 'utf8').toString('base64'));
});

test('formatRedisResponse returns RESP2 format when header set', () => {
  const req = new Request('http://localhost/', {
    headers: { 'Upstash-Response-Format': 'resp2' },
  });
  const output = formatRedisResponse('Hello', req);
  expect(output).toBe('$5\r\nHello\r\n');
});

// --- Tests for jsonResponse ---
test('jsonResponse returns a proper JSON response', async () => {
  const resp = jsonResponse({ test: 123 }, 201);
  expect(resp.status).toBe(201);
  expect(resp.headers.get('Content-Type')).toBe('application/json');
  const text = await resp.text();
  expect(JSON.parse(text)).toEqual({ test: 123 });
});

// --- Tests for buildCommand ---
test('buildCommand builds a generic command from a JSON array', async () => {
  const req = new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(['echo', 'Hello']),
  });
  const { command, args } = await buildCommand(req, '/');
  expect(command).toBe('echo');
  expect(args).toEqual(['Hello']);
});

test('buildCommand rejects array-of-arrays input', async () => {
  const req = new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([['set', 'key', 'value']]),
  });
  expect(buildCommand(req, '/')).rejects.toThrow(
    'Expected a flat JSON array for a single command. For batch commands, please use /pipeline or /multi-exec.'
  );
});

test('buildCommand uses URL path segments when body is not an array', async () => {
  const req = new Request('http://localhost/set/foo/bar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(''),
  });
  const { command, args } = await buildCommand(req, '/set/foo/bar');
  expect(command).toBe('set');
  expect(args).toEqual(['foo', 'bar']);
});

test('buildCommand appends query parameters', async () => {
  const req = new Request('http://localhost/echo?extra=param', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(['echo', 'Hello']),
  });
  const { command, args } = await buildCommand(req, '/echo');
  expect(command).toBe('echo');
  expect(args).toEqual(['Hello', 'extra', 'param']);
});

// --- Tests for executeBatchCommands ---
test('executeBatchCommands works in pipeline mode', async () => {
  const commands = [
    ['set', 'foo', 'bar'],
    ['get', 'foo'],
  ];
  const results = await executeBatchCommands(commands, 'pipeline');
  expect(results).toEqual([
    [null, 'PipelineResult: set foo bar'],
    [null, 'PipelineResult: get foo'],
  ]);
});

test('executeBatchCommands works in multi mode', async () => {
  const commands = [
    ['incr', 'counter'],
    ['get', 'counter'],
  ];
  const results = await executeBatchCommands(commands, 'multi');
  expect(results).toEqual([
    [null, 'MultiResult: incr counter'],
    [null, 'MultiResult: get counter'],
  ]);
});

// --- Tests for handleBatchCommands ---
test('handleBatchCommands returns valid JSON response for pipeline', async () => {
  const req = new Request('http://localhost/pipeline', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer MY_SUPER_SECRET_TOKEN',
    },
    body: JSON.stringify([
      ['set', 'foo', 'bar'],
      ['get', 'foo'],
    ]),
  });
  const resp = await handleBatchCommands(req, 'pipeline');
  const json = await resp.json();
  expect(Array.isArray(json)).toBe(true);
  expect(json[0].result).toBe('PipelineResult: set foo bar');
});

test('handleBatchCommands returns valid JSON response for multi', async () => {
  const req = new Request('http://localhost/multi-exec', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer MY_SUPER_SECRET_TOKEN',
    },
    body: JSON.stringify([
      ['incr', 'counter'],
      ['get', 'counter'],
    ]),
  });
  const resp = await handleBatchCommands(req, 'multi');
  const json = await resp.json();
  expect(Array.isArray(json)).toBe(true);
  expect(json[0].result).toBe('MultiResult: incr counter');
});

// --- Tests for the Main Handler ---
test('handler processes a generic command correctly', async () => {
  // Here we use a generic command JSON array.
  const req = new Request('http://localhost/echo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer MY_SUPER_SECRET_TOKEN',
    },
    body: JSON.stringify(['echo', 'Hello']),
  });
  const resp = await handler(req);
  const json = await resp.json();
  expect(json.result).toBe('Called: echo Hello');
});

test('handler returns unauthorized if no token provided', async () => {
  const req = new Request('http://localhost/echo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(['echo', 'Hello']),
  });
  const resp = await handler(req);
  expect(resp.status).toBe(401);
  const json = await resp.json();
  expect(json.error).toBe('Unauthorized');
});
