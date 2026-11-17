import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Walk } from '../types';

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

const walk = (id: string, createdAt: number): Walk => ({
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

/** storage.ts caches its DB handle, so load a fresh copy for each test. */
async function load() {
  vi.resetModules();
  return import('./storage');
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('walks in IndexedDB', () => {
  it('saves, lists newest first, gets and deletes', async () => {
    const s = await load();
    await s.saveWalk(walk('a', 1));
    await s.saveWalk(walk('b', 3));
    await s.saveWalk(walk('c', 2));
    expect((await s.listWalks()).map((w) => w.id)).toEqual(['b', 'c', 'a']);
    expect((await s.getWalk('c'))?.createdAt).toBe(2);
    expect(await s.getWalk('zzz')).toBeNull();
    await s.deleteWalk('b');
    expect((await s.listWalks()).map((w) => w.id)).toEqual(['c', 'a']);
    // nothing leaked to the localStorage fallback
    expect(localStorage.getItem('walkdraw.walks.v1')).toBeNull();
  });

  it('overwrites a walk with the same id', async () => {
    const s = await load();
    await s.saveWalk(walk('a', 1));
    await s.saveWalk({ ...walk('a', 1), title: 'renamed' });
    const all = await s.listWalks();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('renamed');
  });
});

describe('walks without IndexedDB (localStorage fallback)', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', undefined);
  });

  it('saves, lists, gets and deletes', async () => {
    const s = await load();
    await s.saveWalk(walk('a', 1));
    await s.saveWalk(walk('b', 2));
    await s.saveWalk({ ...walk('a', 1), title: 'again' });
    expect((await s.listWalks()).map((w) => w.id)).toEqual(['b', 'a']);
    expect((await s.getWalk('a'))?.title).toBe('again');
    await s.deleteWalk('a');
    expect((await s.listWalks()).map((w) => w.id)).toEqual(['b']);
  });

  it('treats corrupt data as empty', async () => {
    localStorage.setItem('walkdraw.walks.v1', '{not json');
    const s = await load();
    expect(await s.listWalks()).toEqual([]);
    localStorage.setItem('walkdraw.walks.v1', '{"a":1}');
    expect(await s.listWalks()).toEqual([]);
  });

  it('does not throw when localStorage is full', async () => {
    const s = await load();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await expect(s.saveWalk(walk('a', 1))).resolves.toBeUndefined();
  });
});

describe('draft', () => {
  it('round-trips a draft with at least 2 points', async () => {
    const s = await load();
    const d = { points: [{ lat: 0, lng: 0, t: 0 }, { lat: 1, lng: 1, t: 1 }], color: '#f00', width: 3, guideId: null, startedAt: 5 };
    s.saveDraft(d);
    expect(s.loadDraft()).toEqual(d);
    s.clearDraft();
    expect(s.loadDraft()).toBeNull();
  });

  it('ignores a draft with fewer than 2 points or bad JSON', async () => {
    const s = await load();
    s.saveDraft({ points: [{ lat: 0, lng: 0, t: 0 }], color: '', width: 1, guideId: null, startedAt: 0 });
    expect(s.loadDraft()).toBeNull();
    localStorage.setItem('walkdraw.draft.v1', 'null');
    expect(s.loadDraft()).toBeNull();
    localStorage.setItem('walkdraw.draft.v1', '{');
    expect(s.loadDraft()).toBeNull();
  });
});

describe('newId', () => {
  it('returns unique ids', async () => {
    const s = await load();
    const ids = new Set(Array.from({ length: 50 }, () => s.newId()));
    expect(ids.size).toBe(50);
  });

  it('works without crypto.randomUUID', async () => {
    vi.stubGlobal('crypto', {});
    const s = await load();
    expect(s.newId()).toMatch(/^w_[0-9a-z]+_[0-9a-z]+$/);
  });
});

describe('saved routes', () => {
  const route = (id: string) => ({
    id,
    title: id,
    createdAt: 0,
    path: [{ lat: 0, lng: 0 }],
    totalDistanceM: 100,
    kind: 'pin' as const,
    isRealRoad: false,
  });

  it('adds newest first, replaces same id, deletes', async () => {
    const s = await load();
    s.saveFavoriteRoute(route('a'));
    s.saveFavoriteRoute(route('b'));
    s.saveFavoriteRoute({ ...route('a'), title: 'A2' });
    expect(s.listSavedRoutes().map((r) => r.title)).toEqual(['A2', 'b']);
    expect(s.deleteSavedRoute('a').map((r) => r.id)).toEqual(['b']);
    expect(s.listSavedRoutes().map((r) => r.id)).toEqual(['b']);
  });

  // Known bug (issue #10): remove .fails once fixed.
  it.fails('keeps at most 60, and the returned list matches what was stored', async () => {
    const s = await load();
    let returned: ReturnType<typeof s.saveFavoriteRoute> = [];
    for (let i = 0; i < 61; i++) returned = s.saveFavoriteRoute(route(`r${i}`));
    expect(s.listSavedRoutes()).toHaveLength(60);
    expect(returned).toEqual(s.listSavedRoutes());
  });
});

describe('partner state', () => {
  it('has safe defaults and round-trips', async () => {
    const s = await load();
    expect(s.loadPartnerState()).toEqual({ activeId: null, counts: {}, starterClaimed: false });
    s.savePartnerState({ activeId: 'cat', counts: { cat: 2 }, starterClaimed: true });
    expect(s.loadPartnerState()).toEqual({ activeId: 'cat', counts: { cat: 2 }, starterClaimed: true });
  });

  it('fills missing fields from old saves', async () => {
    localStorage.setItem('walkdraw.partners.v1', '{"activeId":"dog"}');
    const s = await load();
    expect(s.loadPartnerState()).toEqual({ activeId: 'dog', counts: {}, starterClaimed: false });
  });
});
