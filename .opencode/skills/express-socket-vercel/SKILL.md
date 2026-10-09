---
name: express-socket-vercel
description: Use when deploying Express and/or Socket.IO on Vercel, or when adding/reusing realtime websocket files (api/socket.js, lib/realtime.js) in this project. Covers the exact-path routing gotcha, required websocket transport, the server-side path normalizer, Fluid Compute requirement, and a copy-paste recipe for a new endpoint.
---

# Express + Socket.IO on Vercel

Working, verified recipe for running an Express app with Socket.IO as a Vercel
Function (WebSockets public beta). Use the files in this repo as the reference
implementation:

- `vercel.json` — disables framework detection and sets `maxDuration`.
- `api/socket.js` — the Vercel Function; exports the `http.Server`.
- `lib/realtime.js` — shared Express + Socket.IO factory and URL normalizer.
- `scripts/dev.js` — local-only dev server (`server.listen`).
- `public/index.html` — client; picks the correct `path` per environment.

## The one thing that breaks everything

A **non-Next `api/` Function only matches its exact route** (`/api/socket`).
It is *not* a prefix mount:

- `/api/socket` → reaches the Function.
- `/api/socket/?EIO=4&transport=websocket` (WebSocket upgrade) → reaches it.
- `/api/socket/socket.io/...` and `/api/socket/health` → **Vercel 404**,
  never reaches the Function.
- HTTP long-polling (`transport=polling`) does **not** route → 404.

So the Socket.IO client must use the Function's exact path, not the default
`/socket.io`, and must use the websocket transport.

## Required setup

1. **Disable framework detection.** With `express` in `dependencies`, Vercel
   picks the Express preset and fails with
   `No entrypoint found` / `No entrypoint found which imports express`.
   `"framework": null` makes Vercel use `api/` (Functions) + `public/`
   (static).

2. **Function must be in `api/` and export the `http.Server`** (not call
   `listen`). Vercel manages the server.

3. **Client must use `transports: ['websocket']`.** Long-polling does not work
   on Vercel Functions.

4. **Client must use `path: '/api/socket'` on Vercel** (`/socket.io` locally,
   where the same server listens at root).

5. **Fluid Compute must be enabled** (default for projects created on/after
   2025-04-23). No env var is required.

## Copy-paste recipe

### `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "functions": {
    "api/socket.js": { "maxDuration": 300 }
  }
}
```

### `lib/realtime.js` (shared factory)

```js
import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';

// Pin every Engine.IO request to the default "/socket.io" path, whether the
// platform passed "/socket.io/..." or "/api/socket/...".
function normalizeUrl(url) {
  const q = url.indexOf('?');
  const pathname = q === -1 ? url : url.slice(0, q);
  const search = q === -1 ? '' : url.slice(q);
  if (!search.includes('EIO=')) return url;
  const match = pathname.match(/\/socket\.io(\/.*)?$/);
  let rest = match ? match[1] || '/' : pathname.replace(/^\/api\/socket/, '') || '/';
  if (!rest.startsWith('/')) rest = '/' + rest;
  return '/socket.io' + rest + search;
}

export function createRealtimeServer({ staticDir } = {}) {
  const app = express();
  const server = createServer(app);

  app.use((req, _res, next) => { req.url = normalizeUrl(req.url || ''); next(); });
  if (staticDir) app.use(express.static(staticDir));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // MUST run before Socket.IO attaches its own 'upgrade' listener, so the
  // URL is normalized before Engine.IO inspects it. Express middleware never
  // runs for upgrade requests, so this is required for the websocket path.
  server.on('upgrade', (req) => { req.url = normalizeUrl(req.url || ''); });

  const io = new Server(server, {
    transports: ['websocket'], // required on Vercel
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    socket.emit('system', { message: `connected (${socket.id})` });
    socket.on('chat:message', (p) => {
      const text = String(p?.text ?? '').trim();
      if (text) io.emit('chat:message', { id: socket.id, text: text.slice(0, 500) });
    });
  });

  return { app, server, io };
}
```

### `api/socket.js` (Vercel Function)

```js
import { createRealtimeServer } from '../lib/realtime.js';
const { server } = createRealtimeServer();
export default server; // do NOT call server.listen() on Vercel
```

### `scripts/dev.js` (local only; keep out of Vercel via `.vercelignore`)

```js
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRealtimeServer } from '../lib/realtime.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const { server } = createRealtimeServer({ staticDir: join(__dirname, '..', 'public') });
server.listen(process.env.PORT || 3000, () => console.log('http://localhost:3000'));
```

### Client (browser)

```js
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
const socket = io({
  path: isLocal ? '/socket.io' : '/api/socket',
  transports: ['websocket'],
});
```

### Node client (for testing a deployment)

```js
import { io } from 'socket.io-client';
const socket = io('https://your-app.vercel.app', {
  path: '/api/socket',
  transports: ['websocket'],
});
```

## Adding another event / namespace

1. Add the handler in `lib/realtime.js` inside `io.on('connection', ...)`.
2. Emit from the client with the same event name.
3. Keep it module-scoped: `io.emit(...)` only reaches clients on the **same
   Function instance**. For cross-instance delivery (rooms, presence, history),
   add Redis (Vercel Marketplace) or Vercel Queues.

The endpoint path never changes, so no `vercel.json` edits are needed for new
events.

## Verify

```bash
# local
pnpm dev
curl -s http://localhost:3000/health                 # {"ok":true,...}
curl -s -i --http1.1 -N \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "http://localhost:3000/socket.io/?EIO=4&transport=websocket"   # 101

# deployed (note the exact path + query)
curl -s -i --http1.1 -N \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://your-app.vercel.app/api/socket/?EIO=4&transport=websocket"  # 101
```

End-to-end: connect with `socket.io-client` (`path: '/api/socket'`), emit, and
confirm your own broadcast comes back. A plain `101` proves routing; the echo
proves the Socket.IO protocol handshake.

## Limits (do not fight these)

| Topic | Behavior |
| --- | --- |
| Connection lifetime | Closes at Function `maxDuration` (300s Hobby; ~800s Pro; 1800s beta). Reconnect with backoff. |
| Instance pinning | One connection is bound to one Function instance for its life. |
| Shared state | In-memory only per instance. Use Redis for rooms/presence/history. |
| Polling | Unsupported; websocket transport is mandatory. |
| Static + Function | `public/` is served by Vercel; `api/*` are Functions. |

## Common errors and fixes

- `No entrypoint found` / `No entrypoint found which imports express` → you
  forgot `"framework": null`, or a root `server.js` is confusing detection.
  Keep the dev server in `scripts/` and list it in `.vercelignore`.
- `wss://.../socket.io/...` fails / `GET /socket.io 404` → client is using the
  default path. Set `path: '/api/socket'` on Vercel.
- `xhr poll error` → client is using polling. Set
  `transports: ['websocket']`.
- Connects but messages don't appear across tabs → clients landed on different
  Function instances. Add Redis.
