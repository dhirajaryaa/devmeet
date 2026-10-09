import { createRealtimeServer } from '../lib/realtime.js';

// Keep the default Socket.IO path ("/socket.io"). Vercel strips the
// "/api/socket" prefix before forwarding to this Function, so the client
// connects at "/api/socket/socket.io".
const { server } = createRealtimeServer();

// On Vercel, export the HTTP server (do NOT call server.listen).
export default server;
