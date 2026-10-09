import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';

export function createRealtimeServer({ staticDir } = {}) {
  const app = express();
  const server = createServer(app);

  if (staticDir) {
    app.use(express.static(staticDir));
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

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
