// SQLite 저장소 (Node 22 내장 node:sqlite — 별도 DB 서버 불필요)
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';

export const TABLES = /** @type {const} */ (['walks', 'saved_routes']);
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60일

const hashToken = (t) => createHash('sha256').update(t).digest('hex');

/** @param {string} file  ':memory:' 이면 메모리 DB (테스트용) */
export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY,
      google_sub  TEXT NOT NULL UNIQUE,
      email       TEXT NOT NULL DEFAULT '',
      name        TEXT NOT NULL DEFAULT '',
      picture     TEXT,
      created_at  INTEGER NOT NULL,
      last_login  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS walks (
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id          TEXT NOT NULL,
      data        TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS saved_routes (
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id          TEXT NOT NULL,
      data        TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS partner_states (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data        TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);
  return db;
}

/** 저장소 함수 모음. 모든 데이터 함수는 userId로 범위가 제한된다. */
export function createStore(db, now = () => Date.now()) {
  const q = {
    upsertUser: db.prepare(`
      INSERT INTO users (google_sub, email, name, picture, created_at, last_login)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(google_sub) DO UPDATE SET
        email = excluded.email, name = excluded.name,
        picture = excluded.picture, last_login = excluded.last_login
      RETURNING id, email, name, picture`),
    insertSession: db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ),
    sessionUser: db.prepare(`
      SELECT u.id, u.email, u.name, u.picture, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    partnersGet: db.prepare('SELECT data FROM partner_states WHERE user_id = ?'),
    partnersPut: db.prepare(`
      INSERT INTO partner_states (user_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
  };
  const t = Object.fromEntries(
    TABLES.map((name) => [
      name,
      {
        rows: db.prepare(`SELECT id, deleted FROM ${name} WHERE user_id = ? ORDER BY id`),
        get: db.prepare(`SELECT id, data FROM ${name} WHERE user_id = ? AND id = ? AND deleted = 0`),
        put: db.prepare(`
          INSERT INTO ${name} (user_id, id, data, created_at, updated_at, deleted)
          VALUES (?, ?, ?, ?, ?, 0)
          ON CONFLICT(user_id, id) DO UPDATE SET
            data = excluded.data, updated_at = excluded.updated_at, deleted = 0`),
        del: db.prepare(`
          INSERT INTO ${name} (user_id, id, data, created_at, updated_at, deleted)
          VALUES (?, ?, '{}', ?, ?, 1)
          ON CONFLICT(user_id, id) DO UPDATE SET
            data = '{}', updated_at = excluded.updated_at, deleted = 1`),
      },
    ]),
  );

  const tx = (fn) => {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  return {
    /** Google 프로필로 사용자 생성/갱신 후 새 세션 토큰 발급 */
    login(profile) {
      const ts = now();
      const user = q.upsertUser.get(
        profile.sub,
        profile.email ?? '',
        profile.name ?? '',
        profile.picture ?? null,
        ts,
        ts,
      );
      const token = randomBytes(32).toString('base64url');
      q.insertSession.run(hashToken(token), user.id, ts, ts + SESSION_TTL_MS);
      q.purgeSessions.run(ts);
      return { token, user };
    },
    userForToken(token) {
      if (!token) return null;
      const row = q.sessionUser.get(hashToken(token));
      if (!row || row.expires_at < now()) return null;
      return { id: row.id, email: row.email, name: row.name, picture: row.picture };
    },
    logout(token) {
      q.deleteSession.run(hashToken(token));
    },
    listRows(table, userId) {
      return t[table].rows.all(userId).map((r) => ({ id: r.id, deleted: r.deleted === 1 }));
    },
    fetchData(table, userId, ids) {
      const out = [];
      for (const id of ids) {
        const r = t[table].get.get(userId, id);
        if (r) out.push({ id: r.id, data: JSON.parse(r.data) });
      }
      return out;
    },
    upsert(table, userId, rows) {
      const ts = now();
      tx(() => {
        for (const r of rows) {
          t[table].put.run(userId, r.id, JSON.stringify(r.data), r.createdAt || ts, ts);
        }
      });
    },
    markDeleted(table, userId, ids) {
      const ts = now();
      tx(() => {
        for (const id of ids) t[table].del.run(userId, id, ts, ts);
      });
    },
    getPartners(userId) {
      const r = q.partnersGet.get(userId);
      return r ? JSON.parse(r.data) : null;
    },
    putPartners(userId, state) {
      q.partnersPut.run(userId, JSON.stringify(state), now());
    },
  };
}
