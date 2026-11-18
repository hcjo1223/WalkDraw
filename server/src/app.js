// WalkDraw API — 프레임워크 없이 node:http 하나로.
//
//   POST /api/auth/google        { credential }  → { token, user }   Google ID 토큰 검증 후 세션 발급
//   GET  /api/auth/me                             → { user }
//   POST /api/auth/logout
//   GET  /api/sync/:table/rows                    → [{ id, deleted }]          table = walks | saved_routes
//   POST /api/sync/:table/fetch  { ids }          → [{ id, data }]
//   PUT  /api/sync/:table        { rows: [{ id, data, createdAt }] }
//   POST /api/sync/:table/delete { ids }
//   GET  /api/partners                            → { state | null }
//   PUT  /api/partners           { state }
//   GET  /api/health
//
// 인증: Authorization: Bearer <세션 토큰>. 모든 데이터는 로그인한 사용자 범위로만 읽고 쓴다.
import { TABLES } from './db.js';

const MAX_BODY = 8 * 1024 * 1024;
const MAX_IDS = 500;
const MAX_ROWS = 100;
const LOGIN_LIMIT = { windowMs: 60_000, max: 20 };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isId = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 100;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function idsFrom(body) {
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length > MAX_IDS || !ids.every(isId)) {
    throw new HttpError(400, `ids: 문자열 배열(최대 ${MAX_IDS}개)이어야 해요`);
  }
  return ids;
}

function rowsFrom(body) {
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    throw new HttpError(400, `rows: 배열(최대 ${MAX_ROWS}개)이어야 해요`);
  }
  return rows.map((r) => {
    if (!isObj(r) || !isId(r.id) || !isObj(r.data)) throw new HttpError(400, 'rows 항목 형식이 잘못됐어요');
    const createdAt = Number.isFinite(r.createdAt) ? Number(r.createdAt) : 0;
    return { id: r.id, data: r.data, createdAt };
  });
}

function partnersFrom(body) {
  const s = body?.state;
  if (!isObj(s) || !isObj(s.counts)) throw new HttpError(400, 'state 형식이 잘못됐어요');
  const counts = {};
  for (const [k, v] of Object.entries(s.counts)) {
    if (isId(k) && Number.isFinite(v) && v >= 0) counts[k] = Math.floor(v);
  }
  return {
    activeId: isId(s.activeId) ? s.activeId : null,
    counts,
    starterClaimed: s.starterClaimed === true,
  };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, '요청이 너무 커요');
    chunks.push(c);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON 형식이 잘못됐어요');
  }
}

/**
 * @param {{ store: ReturnType<import('./db.js').createStore>,
 *           verifyGoogle: (credential: string) => Promise<{sub: string, email?: string, name?: string, picture?: string|null}>,
 *           allowedOrigins: string[], now?: () => number }} deps
 */
export function createApp({ store, verifyGoogle, allowedOrigins, now = () => Date.now() }) {
  const origins = new Set(allowedOrigins);
  const loginHits = new Map(); // ip → { start, count }

  function rateLimitLogin(ip) {
    const ts = now();
    const e = loginHits.get(ip);
    if (!e || ts - e.start > LOGIN_LIMIT.windowMs) {
      loginHits.set(ip, { start: ts, count: 1 });
      if (loginHits.size > 10_000) loginHits.clear();
      return;
    }
    e.count += 1;
    if (e.count > LOGIN_LIMIT.max) throw new HttpError(429, '잠시 후 다시 시도해 주세요');
  }

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    res.setHeader('Vary', 'Origin');
  }

  function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'no-store');
    if (body === undefined) {
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }

  function bearer(req) {
    const h = req.headers.authorization ?? '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  }

  function requireUser(req) {
    const user = store.userForToken(bearer(req));
    if (!user) throw new HttpError(401, '로그인이 만료됐어요. 다시 로그인해 주세요.');
    return user;
  }

  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '');
    const m = req.method ?? 'GET';

    if (m === 'GET' && path === '/api/health') return send(res, 200, { ok: true });

    if (m === 'POST' && path === '/api/auth/google') {
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
      rateLimitLogin(ip);
      const { credential } = await readJson(req);
      if (typeof credential !== 'string' || credential.length > 8192) throw new HttpError(400, 'credential이 필요해요');
      let profile;
      try {
        profile = await verifyGoogle(credential);
      } catch {
        throw new HttpError(401, 'Google 로그인 정보를 확인하지 못했어요');
      }
      const { token, user } = store.login(profile);
      return send(res, 200, { token, user });
    }

    if (m === 'GET' && path === '/api/auth/me') return send(res, 200, { user: requireUser(req) });

    if (m === 'POST' && path === '/api/auth/logout') {
      const token = bearer(req);
      if (token) store.logout(token);
      return send(res, 204);
    }

    if (path === '/api/partners') {
      const user = requireUser(req);
      if (m === 'GET') return send(res, 200, { state: store.getPartners(user.id) });
      if (m === 'PUT') {
        store.putPartners(user.id, partnersFrom(await readJson(req)));
        return send(res, 204);
      }
    }

    const sync = path.match(/^\/api\/sync\/([a-z_]+)(?:\/(rows|fetch|delete))?$/);
    if (sync) {
      const [, table, action] = sync;
      if (!TABLES.includes(table)) throw new HttpError(404, '없는 테이블이에요');
      const user = requireUser(req);
      if (m === 'GET' && action === 'rows') return send(res, 200, store.listRows(table, user.id));
      if (m === 'POST' && action === 'fetch') {
        return send(res, 200, store.fetchData(table, user.id, idsFrom(await readJson(req))));
      }
      if (m === 'PUT' && !action) {
        store.upsert(table, user.id, rowsFrom(await readJson(req)));
        return send(res, 204);
      }
      if (m === 'POST' && action === 'delete') {
        store.markDeleted(table, user.id, idsFrom(await readJson(req)));
        return send(res, 204);
      }
    }

    throw new HttpError(404, '없는 경로예요');
  }

  return async function handler(req, res) {
    cors(req, res);
    if (req.method === 'OPTIONS') return send(res, 204);
    try {
      await route(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: '서버 오류가 났어요' });
    }
  };
}
