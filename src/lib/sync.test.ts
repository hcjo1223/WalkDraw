import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Walk } from './geo';
import type { PartnerState, SavedRoute } from './storage';
import {
  SyncEngine,
  loadQueue,
  mergePartnerState,
  planSync,
  type RemoteRow,
  type SyncLocal,
  type SyncRemote,
  type SyncTable,
} from './sync';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const walk = (id: string, createdAt = 1): Walk => ({
  id,
  title: id,
  createdAt,
  points: [{ lat: 0, lng: 0, t: 0 }],
  color: '#000',
  width: 4,
  guideId: null,
  distanceM: 0,
  durationMs: 0,
});

const route = (id: string, createdAt = 1): SavedRoute => ({
  id,
  title: id,
  createdAt,
  path: [{ lat: 0, lng: 0 }],
  totalDistanceM: 10,
  kind: 'pin',
  isRealRoad: true,
});

const emptyPartners = (): PartnerState => ({ activeId: null, counts: {}, starterClaimed: false });

/** 메모리 서버: 계정별 테이블 */
class FakeServer {
  rows: Record<string, Record<SyncTable, Map<string, { data: unknown; deleted: boolean }>>> = {};
  partners: Record<string, PartnerState | null> = {};
  user = 'u1';
  table(t: SyncTable) {
    this.rows[this.user] ??= { walks: new Map(), saved_routes: new Map() };
    return this.rows[this.user][t];
  }
  remote(): SyncRemote {
    return {
      listRows: async (t) =>
        [...this.table(t)].map(([id, r]): RemoteRow => ({ id, deleted: r.deleted })),
      fetchData: async <T,>(t: SyncTable, ids: string[]) =>
        ids
          .filter((id) => this.table(t).has(id))
          .map((id) => ({ id, data: this.table(t).get(id)!.data as T })),
      upsert: async (t, rows) => {
        for (const r of rows) this.table(t).set(r.id, { data: r.data, deleted: false });
      },
      markDeleted: async (t, ids) => {
        for (const id of ids) this.table(t).set(id, { data: {}, deleted: true });
      },
      getPartners: async () => this.partners[this.user] ?? null,
      putPartners: async (s) => {
        this.partners[this.user] = s;
      },
    };
  }
}

class FakeDevice implements SyncLocal {
  walks = new Map<string, Walk>();
  routes: SavedRoute[] = [];
  partners: PartnerState = emptyPartners();
  listWalks = async () => [...this.walks.values()];
  getWalk = async (id: string) => this.walks.get(id) ?? null;
  saveWalk = async (w: Walk) => {
    this.walks.set(w.id, w);
  };
  deleteWalk = async (id: string) => {
    this.walks.delete(id);
  };
  listRoutes = () => this.routes;
  replaceRoutes = (l: SavedRoute[]) => (this.routes = [...l]);
  loadPartners = () => this.partners;
  savePartners = (s: PartnerState) => {
    this.partners = s;
  };
}

describe('planSync', () => {
  it('pushes local-only, pulls remote-only and removes tombstoned', () => {
    const plan = planSync(
      ['a', 'b', 'c'],
      [
        { id: 'b', deleted: false },
        { id: 'c', deleted: true },
        { id: 'd', deleted: false },
        { id: 'e', deleted: true },
      ],
    );
    expect(plan).toEqual({ push: ['a'], pull: ['d'], removeLocal: ['c'] });
  });
});

describe('mergePartnerState', () => {
  it('keeps the max count, OR-s the starter flag and prefers local active partner', () => {
    const merged = mergePartnerState(
      { activeId: null, counts: { corgi: 1, cat: 3 }, starterClaimed: false },
      { activeId: 'owl', counts: { corgi: 2, owl: 1 }, starterClaimed: true },
    );
    expect(merged).toEqual({
      activeId: 'owl',
      counts: { corgi: 2, cat: 3, owl: 1 },
      starterClaimed: true,
    });
  });

  it('returns local state when the server has none', () => {
    const local = { activeId: 'cat', counts: { cat: 1 }, starterClaimed: true };
    expect(mergePartnerState(local, null)).toBe(local);
  });
});

describe('SyncEngine', () => {
  let server: FakeServer;
  let device: FakeDevice;
  let engine: SyncEngine;

  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('localStorage', new MemoryStorage());
    server = new FakeServer();
    device = new FakeDevice();
    engine = new SyncEngine(server.remote(), device);
  });

  it('does nothing while signed out', async () => {
    engine.walkSaved('a');
    expect(loadQueue().walks).toEqual({});
    expect(await engine.syncAll()).toBeNull();
  });

  it('first sign-in uploads device data and downloads account data', async () => {
    device.walks.set('local', walk('local'));
    device.routes = [route('r-local')];
    device.partners = { activeId: 'corgi', counts: { corgi: 1 }, starterClaimed: true };
    server.table('walks').set('remote', { data: walk('remote'), deleted: false });
    server.table('saved_routes').set('r-remote', { data: route('r-remote', 5), deleted: false });
    server.partners.u1 = { activeId: null, counts: { owl: 2 }, starterClaimed: false };

    engine.setUser('u1');
    const r = await engine.syncAll();

    expect(r).toEqual({ pulled: 2, pushed: 2, removed: 0, switchedAccount: false });
    expect([...device.walks.keys()].sort()).toEqual(['local', 'remote']);
    expect(device.routes.map((x) => x.id).sort()).toEqual(['r-local', 'r-remote']);
    expect([...server.table('walks').keys()].sort()).toEqual(['local', 'remote']);
    expect(server.partners.u1).toEqual({
      activeId: 'corgi',
      counts: { owl: 2, corgi: 1 },
      starterClaimed: true,
    });
  });

  it('deletions on another device are applied locally', async () => {
    device.walks.set('gone', walk('gone'));
    server.table('walks').set('gone', { data: {}, deleted: true });
    engine.setUser('u1');
    const r = await engine.syncAll();
    expect(r?.removed).toBe(1);
    expect(device.walks.has('gone')).toBe(false);
  });

  it('queued changes are flushed (put + tombstone)', async () => {
    engine.setUser('u1');
    await engine.syncAll();

    device.walks.set('w1', walk('w1'));
    engine.walkSaved('w1');
    device.routes = [route('r1')];
    engine.routeSaved('r1');
    await engine.flush();
    expect(server.table('walks').get('w1')?.deleted).toBe(false);
    expect(server.table('saved_routes').has('r1')).toBe(true);
    expect(loadQueue()).toEqual({ walks: {}, routes: {}, partners: false });

    device.walks.delete('w1');
    engine.walkDeleted('w1');
    await engine.flush();
    expect(server.table('walks').get('w1')?.deleted).toBe(true);
  });

  it('a failed flush keeps the queue for the next attempt', async () => {
    engine.setUser('u1');
    device.walks.set('w1', walk('w1'));
    engine.walkSaved('w1');
    const remote = server.remote();
    const failing = new SyncEngine({ ...remote, upsert: async () => Promise.reject(new Error('offline')) }, device);
    failing.setUser('u1');
    await expect(failing.flush()).rejects.toThrow('offline');
    expect(loadQueue().walks).toEqual({ w1: 'put' });
    await engine.flush();
    expect(loadQueue().walks).toEqual({});
    expect(server.table('walks').has('w1')).toBe(true);
  });

  it('signing in with a different account replaces device data instead of mixing', async () => {
    device.walks.set('a-walk', walk('a-walk'));
    engine.setUser('u1');
    await engine.syncAll();
    expect(server.table('walks').has('a-walk')).toBe(true);

    engine.setUser(null);
    server.user = 'u2';
    server.table('walks').set('b-walk', { data: walk('b-walk'), deleted: false });
    engine.setUser('u2');
    const r = await engine.syncAll();

    expect(r?.switchedAccount).toBe(true);
    expect([...device.walks.keys()]).toEqual(['b-walk']);
    expect(server.table('walks').has('a-walk')).toBe(false);
    server.user = 'u1';
    expect(server.table('walks').has('a-walk')).toBe(true);
  });
});
