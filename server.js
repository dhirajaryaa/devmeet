import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRealtimeServer } from './lib/realtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const { server } = createRealtimeServer({ staticDir: join(__dirname, 'public') });

server.listen(PORT, () => {
  console.log(`DevMeet running at http://localhost:${PORT}`);
});
