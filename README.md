# DevMeet — Socket.IO + Express on Vercel

Minimal realtime chat used to test whether **Socket.IO + Express works on Vercel**.
It runs the **same code** locally and on Vercel Functions.

## Stack

- `express` — HTTP server / static files
- `socket.io` — realtime transport
- `pnpm` — package manager
- Plain JavaScript (ESM, `"type": "module"`)

## Project layout

```
api/socket.js      Vercel Function (WebSocket endpoint) — exports the http.Server
lib/realtime.js    Shared Express + Socket.IO factory (used by local + Vercel)
scripts/dev.js     Local dev server (calls server.listen) — ignored by Vercel
public/index.html  Chat UI (connects with transports: ['websocket'])
vercel.json        Sets maxDuration for the socket Function
```

## Run locally

```bash
pnpm install
pnpm dev
# open http://localhost:3000
```

Open the page in two tabs, send messages, and they should appear in both.
Local Socket.IO path is `/socket.io`.

## Deploy to Vercel

```bash
pnpm dlx vercel        # first run: link/create project
pnpm dlx vercel --prod # production deploy
```

Or just push to GitHub and import the repo at https://vercel.com/new.
Vercel uses the `api/` directory as Functions and `public/` as static output.

> **Why `"framework": null` in `vercel.json`?** Because `express` is a dependency,
> Vercel's framework detection picks the **Express preset**, which looks for a
> root `app.js`/`server.js` and fails with `No entrypoint found`. Setting
> `framework: null` disables that detection so the `api/` (Functions) +
> `public/` (static) layout is used instead.

> **Requirement:** WebSockets need **Fluid Compute**, which is on by default for
> projects created on/after **April 23, 2025**. For older projects, enable it in
> **Project Settings → Functions → Fluid Compute**, then redeploy.

## Does it actually work on Vercel?

**Yes** — since **June 22, 2026** Vercel Functions support WebSockets in **public
beta on all plans** (Node, Bun, Python). It runs on Fluid Compute.

Two things are required for Socket.IO:

1. **Force the WebSocket transport** — Socket.IO defaults to HTTP long-polling
   first, which does not work on Vercel Functions.
   ```js
   const socket = io({ transports: ['websocket'] });
   ```
2. **Point the client at the Function's exact path.** A non-Next `api/`
   Function is matched at its exact route (`/api/socket`); sub-paths like
   `/api/socket/socket.io/...` 404 at Vercel's router. So on Vercel the client
   uses `path: '/api/socket'`, which makes Socket.IO request
   `/api/socket/?EIO=4&transport=websocket` — that upgrade reaches the Function.
   ```js
   const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
   const socket = io({
     path: isLocal ? '/socket.io' : '/api/socket',
     transports: ['websocket'],
   });
   ```
   Server-side, `lib/realtime.js` normalizes the Engine.IO URL on both the
   Express request and the raw `upgrade` event, so it works whichever path
   Vercel forwards.

Verified end-to-end against `devmeet-4cli.vercel.app`: a real `socket.io-client`
connects with `path: '/api/socket'`, receives `connected`, and gets its own
broadcast message back.

> Note: HTTP long-polling (`transport=polling`) does **not** route to the
> Function on Vercel, so websocket-only transport is mandatory.

## Vercel WebSocket behavior — the important limits

| Topic | Behavior |
| --- | --- |
| Availability | Public beta, all plans, requires Fluid Compute |
| Pinning | One connection is bound to **one Function instance** for its lifetime |
| Duration | Connection closes at the Function **max duration** (300s Hobby; ~800s Pro; 1800s beta) |
| Reconnect | **Expected.** Clients must reconnect with backoff and re-join |
| In-memory state | **Not shared across instances.** Two clients may land on different instances |
| Cross-instance | Use an external store (e.g. **Redis** from the Vercel Marketplace) for rooms/presence/history |

This demo broadcasts with `io.emit(...)`, which only reaches clients on the
**same Function instance**. That is fine for a quick "does it work" test, but for
a real multi-user app you must add Redis (or Vercel Queues) to fan out messages
across instances.

## When NOT to use WebSockets

- **One-way server → client streaming** (e.g. AI token streaming): use **SSE**.
- **Low-frequency updates**: use **polling** / on-demand fetch.
- **Durable jobs**: use **Vercel Queues** + Redis, then relay over the socket.

## Local vs Vercel differences

| | Local (`scripts/dev.js`) | Vercel (`api/socket.js`) |
| --- | --- | --- |
| Listen | `server.listen(PORT)` | Vercel manages the server; do **not** listen |
| Path | `/socket.io` | `/api/socket/socket.io` (prefix stripped server-side) |
| Instances | Single process | Many, load-balanced — add Redis for shared state |
| Lifetime | Forever | Until `maxDuration` (reconnect required) |

## Quick checks

```bash
curl http://localhost:3000/health        # {"ok":true,...}
curl -sI http://localhost:3000/           # 200, serves public/index.html
```

## Reference

- Vercel WebSockets docs: https://vercel.com/docs/functions/websockets
- Vercel KB — do Functions support WebSockets:
  https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections
- Realtime data on Vercel (Redis / SSE / Queues):
  https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel
