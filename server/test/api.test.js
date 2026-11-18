import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createStore, openDb } from '../src/db.js';

const ORIGIN = 'https://walkdraw.example';

/** 가짜 Google 검증기: "good:<sub>" 형태만 통과 */
const verifyGoogle = async (cred) => {
  if (!cred.startsWith('good:')) throw new Error('bad token');
  const sub = cred.slice(5);
  return { sub, email: `${sub}@example.com`, name: `사용자 ${sub}`, picture: null };
};

let server;
let base;

beforeEach(async () => {
  const store = createStore(openDb(':memory:'));
  server = createServer(createApp({ store, verifyGoogle, allowedOrigins: [ORIGIN] }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : undefined };
}

const login = async (sub) => (await call('POST', '/api/auth/google', { body: { credential: `good:${sub}` } })).json;

describe('auth', () => {
  it('issues a session for a valid Google token and rejects bad ones', async () => {
    const bad = await call('POST', '/api/auth/google', { body: { credential: 'forged' } });
    expect(bad.status).toBe(401);

    const { token, user } = await login('a');
    expect(token).toMatch(/^[\w-]{40,}$/);
    expect(user).toMatchObject({ email: 'a@example.com', name: '사용자 a' });

    const me = await call('GET', '/api/auth/me', { token });
    expect(me.status).toBe(200);
    expect(me.json.user.id).toBe(user.id);
  });

  it('same Google account → same user; logout revokes the session', async () => {
    const s1 = await login('a');
    const s2 = await login('a');
    expect(s2.user.id).toBe(s1.user.id);
    expect(s2.token).not.toBe(s1.token);

    await call('POST', '/api/auth/logout', { token: s1.token });
    expect((await call('GET', '/api/auth/me', { token: s1.token })).status).toBe(401);
    expect((await call('GET', '/api/auth/me', { token: s2.token })).status).toBe(200);
  });

  it('requires a session for data endpoints', async () => {
    expect((await call('GET', '/api/sync/walks/rows')).status).toBe(401);
    expect((await call('GET', '/api/partners', { token: 'nope' })).status).toBe(401);
  });

  it('rate-limits repeated login attempts', async () => {
    let last;
    for (let i = 0; i < 21; i++) last = await call('POST', '/api/auth/google', { body: { credential: 'x' } });
    expect(last.status).toBe(429);
  });
});

describe('sync', () => {
  it('upserts, lists, fetches and tombstones rows', async () => {
    const { token } = await login('a');
    const put = await call('PUT', '/api/sync/walks', {
      token,
      body: { rows: [{ id: 'w1', data: { id: 'w1', title: '하트' }, createdAt: 5 }, { id: 'w2', data: { id: 'w2' } }] },
    });
    expect(put.status).toBe(204);

    expect((await call('GET', '/api/sync/walks/rows', { token })).json).toEqual([
      { id: 'w1', deleted: false },
      { id: 'w2', deleted: false },
    ]);
    const fetched = await call('POST', '/api/sync/walks/fetch', { token, body: { ids: ['w1', 'zz'] } });
    expect(fetched.json).toEqual([{ id: 'w1', data: { id: 'w1', title: '하트' } }]);

    await call('POST', '/api/sync/walks/delete', { token, body: { ids: ['w1'] } });
    expect((await call('GET', '/api/sync/walks/rows', { token })).json).toEqual([
      { id: 'w1', deleted: true },
      { id: 'w2', deleted: false },
    ]);
    expect((await call('POST', '/api/sync/walks/fetch', { token, body: { ids: ['w1'] } })).json).toEqual([]);

    // 다시 저장하면 되살아난다
    await call('PUT', '/api/sync/walks', { token, body: { rows: [{ id: 'w1', data: { id: 'w1' } }] } });
    expect((await call('GET', '/api/sync/walks/rows', { token })).json[0]).toEqual({ id: 'w1', deleted: false });
  });

  it('users cannot see or touch each other’s data', async () => {
    const a = await login('a');
    const b = await login('b');
    await call('PUT', '/api/sync/saved_routes', { token: a.token, body: { rows: [{ id: 'r1', data: { secret: 1 } }] } });

    expect((await call('GET', '/api/sync/saved_routes/rows', { token: b.token })).json).toEqual([]);
    expect((await call('POST', '/api/sync/saved_routes/fetch', { token: b.token, body: { ids: ['r1'] } })).json).toEqual([]);

    // B가 같은 id로 지워도 A의 행은 그대로
    await call('POST', '/api/sync/saved_routes/delete', { token: b.token, body: { ids: ['r1'] } });
    expect((await call('GET', '/api/sync/saved_routes/rows', { token: a.token })).json).toEqual([{ id: 'r1', deleted: false }]);
  });

  it('stores partner state per user and sanitizes it', async () => {
    const { token } = await login('a');
    expect((await call('GET', '/api/partners', { token })).json).toEqual({ state: null });
    await call('PUT', '/api/partners', {
      token,
      body: { state: { activeId: 'corgi', counts: { corgi: 2, bad: -1, x: 'y' }, starterClaimed: true, extra: 1 } },
    });
    expect((await call('GET', '/api/partners', { token })).json).toEqual({
      state: { activeId: 'corgi', counts: { corgi: 2 }, starterClaimed: true },
    });
  });

  it('validates input and unknown tables', async () => {
    const { token } = await login('a');
    expect((await call('GET', '/api/sync/users/rows', { token })).status).toBe(404);
    expect((await call('PUT', '/api/sync/walks', { token, body: { rows: [{ id: '', data: {} }] } })).status).toBe(400);
    expect((await call('POST', '/api/sync/walks/fetch', { token, body: { ids: 'w1' } })).status).toBe(400);
  });
});

describe('cors', () => {
  it('allows only configured origins', async () => {
    const ok = await call('OPTIONS', '/api/sync/walks/rows', { headers: { Origin: ORIGIN } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const evil = await call('OPTIONS', '/api/sync/walks/rows', { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
});
