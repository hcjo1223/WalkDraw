import type { Walk } from '../types';

/**
 * 로컬 저장소: IndexedDB 우선, 막히면(사생활 모드 등) localStorage로 자동 대체.
 * 로그인 없이 이 기기에만 남는다.
 */
const DB_NAME = 'walkdraw';
const DB_VERSION = 1;
const STORE = 'walks';
const LS_KEY = 'walkdraw.walks.v1';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no-idb'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb-open-failed'));
    req.onblocked = () => reject(new Error('idb-blocked'));
  });
  dbPromise = p;
  p.catch(() => {
    dbPromise = null;
  });
  return p;
}

function readLs(): Walk[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Walk[]) : [];
  } catch {
    return [];
  }
}

function writeLs(walks: Walk[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(walks));
  } catch {
    /* 용량 초과 등 — 조용히 무시 */
  }
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb-request-failed'));
  });
}

export async function saveWalk(walk: Walk): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(walk) as IDBRequest<IDBValidKey>);
  } catch {
    const list = readLs().filter((w) => w.id !== walk.id);
    list.push(walk);
    writeLs(list);
  }
}

export async function listWalks(): Promise<Walk[]> {
  try {
    const all = await withStore<Walk[]>('readonly', (s) => s.getAll() as IDBRequest<Walk[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return readLs().sort((a, b) => b.createdAt - a.createdAt);
  }
}

export async function getWalk(id: string): Promise<Walk | null> {
  try {
    const w = await withStore<Walk | undefined>('readonly', (s) => s.get(id) as IDBRequest<Walk | undefined>);
    return w ?? null;
  } catch {
    return readLs().find((w) => w.id === id) ?? null;
  }
}

export async function deleteWalk(id: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
  } catch {
    writeLs(readLs().filter((w) => w.id !== id));
  }
}

/** 기록 중 새로고침 대비 임시 저장 */
const DRAFT_KEY = 'walkdraw.draft.v1';

export type Draft = {
  points: Walk['points'];
  color: string;
  width: number;
  guideId: string | null;
  startedAt: number;
};

export function saveDraft(draft: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || !Array.isArray(d.points) || d.points.length < 2) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- 찜한 코스 (북마크) ---------------- */

const SAVED_ROUTES_KEY = 'walkdraw.routes.v1';

export type SavedRoute = {
  id: string;
  title: string;
  createdAt: number;
  path: Array<{ lat: number; lng: number }>;
  totalDistanceM: number;
  similarity?: number;
  kind: 'sketch' | 'ai' | 'pin' | 'guide';
  isRealRoad: boolean;
};

export function listSavedRoutes(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(SAVED_ROUTES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as SavedRoute[]) : [];
  } catch {
    return [];
  }
}

export function saveFavoriteRoute(route: SavedRoute): SavedRoute[] {
  const list = listSavedRoutes().filter((r) => r.id !== route.id);
  list.unshift(route);
  try {
    localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(list.slice(0, 60)));
  } catch {
    /* ignore */
  }
  return list;
}

export function deleteSavedRoute(id: string): SavedRoute[] {
  const list = listSavedRoutes().filter((r) => r.id !== id);
  try {
    localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

/* ---------------- 파트너 도감 상태 ---------------- */

const PARTNERS_KEY = 'walkdraw.partners.v1';

export type PartnerState = {
  activeId: string | null;
  counts: Record<string, number>;
  starterClaimed: boolean;
};

export function loadPartnerState(): PartnerState {
  try {
    const raw = localStorage.getItem(PARTNERS_KEY);
    if (!raw) return { activeId: null, counts: {}, starterClaimed: false };
    const parsed = JSON.parse(raw) as PartnerState;
    return {
      activeId: parsed.activeId ?? null,
      counts: parsed.counts ?? {},
      starterClaimed: Boolean(parsed.starterClaimed),
    };
  } catch {
    return { activeId: null, counts: {}, starterClaimed: false };
  }
}

export function savePartnerState(state: PartnerState): void {
  try {
    localStorage.setItem(PARTNERS_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
