import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';

// On Vercel the Function is only reached through a rewrite, so Engine.IO
// requests can arrive as "/socket.io/..." (original) or "/api/socket..."
// (rewritten destination). Pin them all to the default "/socket.io" path so
// Socket.IO always matches, whichever path the platform passed through.
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

function normalizeRequest(req) {
  req.url = normalizeUrl(req.url || '');
}

export function createRealtimeServer({ staticDir } = {}) {
  const app = express();
  const server = createServer(app);

  app.use((req, _res, next) => {
    normalizeRequest(req);
    next();
  });

  if (staticDir) {
    app.use(express.static(staticDir));
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  // Register BEFORE Socket.IO attaches its own "upgrade" listener, so the URL
  // is normalized by the time Engine.IO inspects it. Express middleware never
  // runs for upgrade requests, hence this is required for the websocket path.
  server.on('upgrade', normalizeRequest);

  const io = new Server(server, {
    // Vercel requires the client to use the websocket transport directly.
    transports: ['websocket'],
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    console.log('connected', socket.id, 'transport=', socket.conn.transport.name);

    socket.emit('system', { message: `connected (${socket.id})` });

    socket.on('chat:message', (payload) => {
      const text = String(payload?.text ?? '').trim();
      if (!text) return;

      io.emit('chat:message', {
        id: socket.id,
        name: String(payload?.name ?? 'anon').slice(0, 32) || 'anon',
        text: text.slice(0, 500),
        at: Date.now(),
      });
    });

    socket.on('disconnect', (reason) => {
      console.log('disconnect', socket.id, reason);
    });
  });

  return { app, server, io };
}
