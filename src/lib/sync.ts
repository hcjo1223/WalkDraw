/**
 * 서버 동기화 — "기기 우선(local-first)".
 *
 * - 앱은 언제나 기기 저장소(IndexedDB/localStorage)를 읽고 쓴다. 오프라인에서도 그대로 동작한다.
 * - 로그인(서버 세션) 중에 생긴 변경은 대기열에 쌓였다가 서버로 올라간다(실패하면 다음 동기화 때 재시도).
 * - 전체 동기화(로그인 직후 · 앱 시작 · 온라인 복귀)는
 *   ① 대기열 전송 → ② 서버에만 있는 항목 내려받기 → ③ 기기에만 있는 항목 올리기
 *   → ④ 다른 기기에서 지운 항목 지우기 → ⑤ 파트너 도감 병합 순서로 진행한다.
 * - 삭제는 서버에 `deleted = true`(묘비)로 남겨 다른 기기도 지울 수 있게 한다.
 * - 다른 계정으로 로그인하면, 이전 계정 기록이 섞이지 않도록 기기 데이터를 새 계정 데이터로 바꾼다.
 */
import type { Walk } from './geo';
import type { PartnerState, SavedRoute } from './storage';

export type SyncTable = 'walks' | 'saved_routes';

export interface RemoteRow {
  id: string;
  deleted: boolean;
}

export interface RemoteItem<T> {
  id: string;
  data: T;
}

/** 서버 접근 (테스트에서는 가짜로 바꿔 끼운다) */
export interface SyncRemote {
  listRows(table: SyncTable): Promise<RemoteRow[]>;
  fetchData<T>(table: SyncTable, ids: string[]): Promise<RemoteItem<T>[]>;
  upsert(table: SyncTable, rows: Array<{ id: string; data: unknown; createdAt: number }>): Promise<void>;
  markDeleted(table: SyncTable, ids: string[]): Promise<void>;
  getPartners(): Promise<PartnerState | null>;
  putPartners(state: PartnerState): Promise<void>;
}

/** 기기 저장소 접근 */
export interface SyncLocal {
  listWalks(): Promise<Walk[]>;
  getWalk(id: string): Promise<Walk | null>;
  saveWalk(w: Walk): Promise<void>;
  deleteWalk(id: string): Promise<void>;
  listRoutes(): SavedRoute[];
  replaceRoutes(list: SavedRoute[]): SavedRoute[];
  loadPartners(): PartnerState;
  savePartners(s: PartnerState): void;
}

/* ---------------- 순수 계산 (단위 테스트 대상) ---------------- */

export interface SyncPlan {
  /** 서버에 올릴 기기 항목 */
  push: string[];
  /** 서버에서 내려받을 항목 */
  pull: string[];
  /** 다른 기기에서 지워져 기기에서도 지울 항목 */
  removeLocal: string[];
}

export function planSync(localIds: string[], remote: RemoteRow[]): SyncPlan {
  const local = new Set(localIds);
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const push: string[] = [];
  const pull: string[] = [];
  const removeLocal: string[] = [];
  for (const id of local) {
    const r = remoteById.get(id);
    if (!r) push.push(id);
    else if (r.deleted) removeLocal.push(id);
  }
  for (const r of remote) {
    if (!r.deleted && !local.has(r.id)) pull.push(r.id);
  }
  return { push, pull, removeLocal };
}

/** 파트너 도감 병합: 획득 수는 큰 값, 첫 선물은 어느 쪽이든 받았으면 받은 것으로 */
export function mergePartnerState(local: PartnerState, remote: PartnerState | null): PartnerState {
  if (!remote) return local;
  const counts: Record<string, number> = { ...remote.counts };
  for (const [id, n] of Object.entries(local.counts)) {
    counts[id] = Math.max(n, counts[id] ?? 0);
  }
  return {
    activeId: local.activeId ?? remote.activeId ?? null,
    counts,
    starterClaimed: local.starterClaimed || remote.starterClaimed,
  };
}

export function samePartnerState(a: PartnerState, b: PartnerState | null): boolean {
  if (!b) return false;
  if (a.activeId !== b.activeId || a.starterClaimed !== b.starterClaimed) return false;
  const ka = Object.keys(a.counts);
  const kb = Object.keys(b.counts);
  return ka.length === kb.length && ka.every((k) => a.counts[k] === b.counts[k]);
}

/* ---------------- 대기열 ---------------- */

const QUEUE_KEY = 'walkdraw.sync.queue.v1';
const OWNER_KEY = 'walkdraw.sync.owner.v1';
const LAST_SYNC_KEY = 'walkdraw.sync.last.v1';

export interface SyncQueue {
  walks: Record<string, 'put' | 'del'>;
  routes: Record<string, 'put' | 'del'>;
  partners: boolean;
}

const emptyQueue = (): SyncQueue => ({ walks: {}, routes: {}, partners: false });

export function loadQueue(): SyncQueue {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return emptyQueue();
    const q = JSON.parse(raw) as Partial<SyncQueue>;
    return { walks: q.walks ?? {}, routes: q.routes ?? {}, partners: Boolean(q.partners) };
  } catch {
    return emptyQueue();
  }
}

function saveQueue(q: SyncQueue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}

export function clearQueue() {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
}

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

/* ---------------- 상태 알림 ---------------- */

export type SyncStatus =
  | { state: 'off' }
  | { state: 'syncing' }
  | { state: 'idle'; lastSyncedAt: number | null }
  | { state: 'error'; message: string; lastSyncedAt: number | null };

let status: SyncStatus = { state: 'off' };
const listeners = new Set<(s: SyncStatus) => void>();

function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l(s));
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(l: (s: SyncStatus) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function lastSyncedAt(): number | null {
  const v = Number(lsGet(LAST_SYNC_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/* ---------------- 엔진 ---------------- */

export interface SyncResult {
  pulled: number;
  pushed: number;
  removed: number;
  /** 다른 계정으로 바뀌어 기기 데이터를 교체했는지 */
  switchedAccount: boolean;
}

export class SyncEngine {
  private userId: string | null = null;
  private running: Promise<unknown> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private remote: SyncRemote,
    private local: SyncLocal,
  ) {}

  get active() {
    return this.userId !== null;
  }

  /** 로그인 상태 설정. null이면 동기화 중지 */
  setUser(userId: string | null) {
    this.userId = userId;
    if (!userId) {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      setStatus({ state: 'off' });
    } else if (status.state === 'off') {
      setStatus({ state: 'idle', lastSyncedAt: lastSyncedAt() });
    }
  }

  /* --- 변경 기록 (로그인 중일 때만 대기열에 쌓는다) --- */

  walkSaved(id: string) {
    this.enqueue((q) => (q.walks[id] = 'put'));
  }
  walkDeleted(id: string) {
    this.enqueue((q) => (q.walks[id] = 'del'));
  }
  routeSaved(id: string) {
    this.enqueue((q) => (q.routes[id] = 'put'));
  }
  routeDeleted(id: string) {
    this.enqueue((q) => (q.routes[id] = 'del'));
  }
  partnersChanged() {
    this.enqueue((q) => (q.partners = true));
  }

  private enqueue(fn: (q: SyncQueue) => void) {
    if (!this.userId) return;
    const q = loadQueue();
    fn(q);
    saveQueue(q);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch(() => {});
    }, 800);
  }

  /** 대기열만 전송 */
  async flush(): Promise<void> {
    if (!this.userId) return;
    await this.exclusive(() => this.flushInner(), false);
  }

  /** 전체 동기화. 동시에 여러 번 불려도 한 번씩 순서대로 돈다. */
  async syncAll(): Promise<SyncResult | null> {
    if (!this.userId) return null;
    return this.exclusive(() => this.syncInner(), true);
  }

  private async exclusive<T>(fn: () => Promise<T>, report: boolean): Promise<T> {
    while (this.running) {
      try {
        await this.running;
      } catch {
        /* 앞 작업 실패는 무시하고 이어서 실행 */
      }
    }
    if (report) setStatus({ state: 'syncing' });
    const p = fn();
    this.running = p;
    try {
      const r = await p;
      if (report || status.state === 'error') {
        if (report) lsSet(LAST_SYNC_KEY, String(Date.now()));
        if (this.userId) setStatus({ state: 'idle', lastSyncedAt: lastSyncedAt() });
      }
      return r;
    } catch (e) {
      if (this.userId) {
        setStatus({
          state: 'error',
          message: e instanceof Error ? e.message : String(e),
          lastSyncedAt: lastSyncedAt(),
        });
      }
      throw e;
    } finally {
      if (this.running === p) this.running = null;
    }
  }

  private async flushInner(): Promise<void> {
    const q = loadQueue();
    const done = emptyQueue();

    // 산책 기록
    const walkPuts: Walk[] = [];
    const walkDels: string[] = [];
    for (const [id, op] of Object.entries(q.walks)) {
      if (op === 'del') walkDels.push(id);
      else {
        const w = await this.local.getWalk(id);
        if (w) walkPuts.push(w);
      }
    }
    await this.remote.upsert(
      'walks',
      walkPuts.map((w) => ({ id: w.id, data: w, createdAt: w.createdAt })),
    );
    await this.remote.markDeleted('walks', walkDels);
    for (const id of Object.keys(q.walks)) done.walks[id] = q.walks[id];

    // 찜한 코스
    const routes = this.local.listRoutes();
    const routePuts: SavedRoute[] = [];
    const routeDels: string[] = [];
    for (const [id, op] of Object.entries(q.routes)) {
      if (op === 'del') routeDels.push(id);
      else {
        const r = routes.find((x) => x.id === id);
        if (r) routePuts.push(r);
      }
    }
    await this.remote.upsert(
      'saved_routes',
      routePuts.map((r) => ({ id: r.id, data: r, createdAt: r.createdAt })),
    );
    await this.remote.markDeleted('saved_routes', routeDels);
    for (const id of Object.keys(q.routes)) done.routes[id] = q.routes[id];

    // 파트너
    if (q.partners) {
      const remote = await this.remote.getPartners();
      const merged = mergePartnerState(this.local.loadPartners(), remote);
      await this.remote.putPartners(merged);
      done.partners = true;
    }

    // 처리하는 사이 새로 쌓인 항목은 남긴다
    const latest = loadQueue();
    for (const [id, op] of Object.entries(done.walks)) if (latest.walks[id] === op) delete latest.walks[id];
    for (const [id, op] of Object.entries(done.routes)) if (latest.routes[id] === op) delete latest.routes[id];
    if (done.partners) latest.partners = false;
    saveQueue(latest);
  }

  private async syncInner(): Promise<SyncResult> {
    const userId = this.userId!;
    const owner = lsGet(OWNER_KEY);
    const switchedAccount = owner !== null && owner !== userId;

    if (switchedAccount) {
      // 이전 계정의 기기 데이터는 이미 그 계정 서버에 있다 → 새 계정 데이터로 교체
      for (const w of await this.local.listWalks()) await this.local.deleteWalk(w.id);
      this.local.replaceRoutes([]);
      this.local.savePartners({ activeId: null, counts: {}, starterClaimed: false });
      clearQueue();
    } else {
      await this.flushInner();
    }

    let pulled = 0;
    let pushed = 0;
    let removed = 0;

    // 산책 기록
    const localWalks = await this.local.listWalks();
    const walkPlan = planSync(
      localWalks.map((w) => w.id),
      await this.remote.listRows('walks'),
    );
    for (const id of walkPlan.removeLocal) await this.local.deleteWalk(id);
    for (const item of await this.remote.fetchData<Walk>('walks', walkPlan.pull)) {
      if (item.data && Array.isArray(item.data.points)) await this.local.saveWalk(item.data);
    }
    const toPushWalks = localWalks.filter((w) => walkPlan.push.includes(w.id));
    await this.remote.upsert(
      'walks',
      toPushWalks.map((w) => ({ id: w.id, data: w, createdAt: w.createdAt })),
    );
    pulled += walkPlan.pull.length;
    pushed += toPushWalks.length;
    removed += walkPlan.removeLocal.length;

    // 찜한 코스
    const localRoutes = this.local.listRoutes();
    const routePlan = planSync(
      localRoutes.map((r) => r.id),
      await this.remote.listRows('saved_routes'),
    );
    const fetched = await this.remote.fetchData<SavedRoute>('saved_routes', routePlan.pull);
    const keptRoutes = localRoutes.filter((r) => !routePlan.removeLocal.includes(r.id));
    const pulledRoutes = fetched.map((f) => f.data).filter((r) => r && Array.isArray(r.path));
    this.local.replaceRoutes([...keptRoutes, ...pulledRoutes]);
    const toPushRoutes = localRoutes.filter((r) => routePlan.push.includes(r.id));
    await this.remote.upsert(
      'saved_routes',
      toPushRoutes.map((r) => ({ id: r.id, data: r, createdAt: r.createdAt })),
    );
    pulled += pulledRoutes.length;
    pushed += toPushRoutes.length;
    removed += routePlan.removeLocal.length;

    // 파트너 도감
    const remotePartners = await this.remote.getPartners();
    const merged = mergePartnerState(this.local.loadPartners(), remotePartners);
    this.local.savePartners(merged);
    if (!samePartnerState(merged, remotePartners)) await this.remote.putPartners(merged);

    lsSet(OWNER_KEY, userId);
    return { pulled, pushed, removed, switchedAccount };
  }
}
