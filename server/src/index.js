// 실행: GOOGLE_CLIENT_ID=... node src/index.js
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { createStore, openDb } from './db.js';
import { googleVerifier } from './google.js';

const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim();
if (!clientId) {
  console.error('GOOGLE_CLIENT_ID 환경 변수가 필요해요.');
  process.exit(1);
}
const dbFile = process.env.DB_FILE ?? '/data/walkdraw.db';
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ??
  'https://walkdraw.129.203.174.119.sslip.io,https://hcjo1223.github.io,http://localhost:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

mkdirSync(dirname(dbFile), { recursive: true });
const store = createStore(openDb(dbFile));
const server = createServer(createApp({ store, verifyGoogle: googleVerifier(clientId), allowedOrigins }));
server.listen(port, host, () => {
  console.log(`walkdraw-api listening on ${host}:${port} (db: ${dbFile})`);
  console.log(`allowed origins: ${allowedOrigins.join(', ')}`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
