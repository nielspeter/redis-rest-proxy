# Redis REST Proxy

[![GitHub](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/nielspeter/redis-rest-proxy)
[![Docker Image](https://img.shields.io/badge/Docker-Package-blue?logo=docker)](https://github.com/nielspeter/redis-rest-proxy/pkgs/container/redis-rest-proxy)

Redis REST Proxy exposes Redis functionality via a RESTful HTTP API. Ideal for client running in a serverless or edge environments where TCP/IP may not be available.

## Table of Contents

- [Features](#features)
- [Compatibility Notice](#compatibility-notice)
- [Quick Start](#quick-start)
  - [Docker](#docker)
  - [Manual Installation](#manual-installation)
- [Upstash Client Usage](#upstash-client-usage)
- [REST API Usage](#rest-api-usage)
  - [Health Check](#1-health-check)
  - [Generic Command via URL Path](#2-generic-command-via-url-path)
  - [Generic Command Using JSON Body](#3-generic-command-using-json-body)
  - [Pipeline Batch Commands](#4-pipeline-batch-commands)
  - [Multi-exec (Transaction) Batch Commands](#5-multi-exec-transaction-batch-commands)
  - [Base64 Encoded Responses](#6-base64-encoded-responses)
- [Contributing](#contributing)
- [Issues](#issues)
- [License](#license)

## Features

- **RESTful Interface:** Converts HTTP requests into Redis commands.
- **Serverless Friendly:** Connects applications running in serverless environments to Redis.
- **High Performance:** Built with Bun for fast and efficient operation.
- **Upstash Redis client** compatible.

## Compatibility Notice

This proxy is tested with the [Upstash Redis JavaScript Client](https://github.com/upstash/redis-js/tree/main) and aims to maintain basic compatibility with Upstash Redis services.

**Supported**

- Pipeline & multi-exec transactions
- Base64 encoding/decoding
- Basic Redis commands
- Authentication via bearer token

**Not Supported**

- Upstash-specific extensions

---

## Quick Start

### Docker

```bash
docker pull ghcr.io/nielspeter/redis-rest-proxy:latest
docker run -p 3000:3000 \
  -e AUTH_TOKEN="YOUR_AUTH_TOKEN" \
  -e REDIS_HOST="your.redis.host" \
  ghcr.io/nielspeter/redis-rest-proxy
```

### Manual Installation

```bash
git clone https://github.com/nielspeter/redis-rest-proxy.git
cd redis-rest-proxy
bun install
bun run start
```

---

## Upstash Client Usage

```typescript
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: 'http://your-proxy:3000',
  token: 'YOUR_AUTH_TOKEN',
});

// Works like Upstash Redis!
await redis.set('key', 'value');
const result = await redis.get('key');
```

---

## REST API Usage

**Authorization:** Use the `Authorization` header with the value `Bearer YOUR_AUTH_TOKEN` to authenticate requests.

**Command Parsing:** Commands can be provided via:

- URL path segments (e.g., `/get/mykey`)
- A JSON array in the request body (e.g., `["set", "mykey", "hello"]`)

Additionally, URL query parameters (except `_token`) are appended as extra command arguments.

**Response Encoding:** If the header `Upstash-Encoding` or `Encoding` is set to `base64`, string responses (except `"OK"`) will be encoded in Base64. The encoding is applied recursively to arrays and objects.

## Example Usage with cURL

Below are some examples demonstrating how to use the REST API. In these examples, the server is assumed to be running at `http://localhost:3000` and the auth token is `MY_SUPER_SECRET_TOKEN`.

### 1. Health Check

Check that the proxy is healthy and that Redis responds:

```bash
curl -H "Authorization: Bearer MY_SUPER_SECRET_TOKEN" http://localhost:3000/health
```

Expected response:

```json
{
  "status": "healthy",
  "redis": "PONG"
}
```

### 2. Generic Command via URL Path

For a simple command like PING, you can issue the command directly in the URL:

```bash
curl -H "Authorization: Bearer MY_SUPER_SECRET_TOKEN" http://localhost:3000/set/mykey/hello
```

Expected Response:

```json
{
  "result": "Ok"
}
```

### 3. Generic Command Using JSON Body

Send commands as a JSON array in the POST body. For example, to set a key:

```bash
curl -X POST \
  -H "Authorization: Bearer MY_SUPER_SECRET_TOKEN" \
  -H "Content-Type: application/json" \
  -d '["set", "mykey", "hello"]' \
  http://localhost:3000/set
```

Expected Response:

```json
{
  "result": "OK"
}
```

### 4. Pipeline Batch Commands

Execute multiple commands in one request using the /pipeline endpoint. For example, to set a key and then get its value:

```bash
curl -X POST \
  -H "Authorization: Bearer MY_SUPER_SECRET_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[["set", "key1", "value1"], ["get", "key1"]]' \
  http://localhost:3000/pipeline
```

Expected Response:

```json
[{ "result": "OK" }, { "result": "value1" }]
```

### 5. Multi‑exec (Transaction) Batch Commands

Run commands transactionally with the /multi-exec endpoint. For example, to increment a counter and then get its value:

```bash
curl -X POST \
  -H "Authorization: Bearer MY_SUPER_SECRET_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[["incr", "counter"], ["get", "counter"]]' \
  http://localhost:3000/multi-exec
```

Expected Response:

```json
[{ "result": 1 }, { "result": "1" }]
```

### 6. Base64 Encoded Responses

Request Base64 encoding by adding the Upstash-Encoding: base64 header. For example, to get a key’s value in Base64:

```bash
curl -H "Authorization: Bearer MY_SUPER_SECRET_TOKEN" \
  -H "Upstash-Encoding: base64" \
  http://localhost:3000/get/mykey
```

Expected Response:

```json
{
  "result": "aGVsbG8=" // (Base64 for "hello", if that's the value)
}
```

---

## Contributing

We welcome contributions to the project! Please follow these steps to contribute:

1. Fork the repository.
2. Create a new branch for your feature or bugfix.
3. Make your changes and commit them with clear and concise messages.
4. Push your changes to your fork.
5. Submit a pull request to the main repository.

## Issues

[Report Issue](https://github.com/nielspeter/redis-rest-proxy/issues)

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
