/**
 * 앱에서 쓰는 동기화 싱글턴: WalkDraw API 서버 ↔ 기기 저장소.
 * 서버가 설정되지 않았으면 모든 호출이 아무 일도 하지 않는다.
 */
import { api, isServerConfigured } from './api';
import {
  deleteWalk,
  getWalk,
  listSavedRoutes,
  listWalks,
  loadPartnerState,
  replaceSavedRoutes,
  savePartnerState,
  saveWalk,
  type PartnerState,
} from './storage';
import { SyncEngine, type RemoteItem, type RemoteRow, type SyncRemote, type SyncTable } from './sync';

const FETCH_CHUNK = 200;
const UPSERT_CHUNK = 20;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const serverRemote: SyncRemote = {
  listRows: (table: SyncTable) => api<RemoteRow[]>('GET', `/api/sync/${table}/rows`),

  async fetchData<T>(table: SyncTable, ids: string[]): Promise<RemoteItem<T>[]> {
    const out: RemoteItem<T>[] = [];
    for (const part of chunk(ids, FETCH_CHUNK)) {
      out.push(...(await api<RemoteItem<T>[]>('POST', `/api/sync/${table}/fetch`, { ids: part })));
    }
    return out;
  },

  async upsert(table, rows) {
    for (const part of chunk(rows, UPSERT_CHUNK)) {
      await api('PUT', `/api/sync/${table}`, { rows: part });
    }
  },

  async markDeleted(table, ids) {
    for (const part of chunk(ids, FETCH_CHUNK)) {
      await api('POST', `/api/sync/${table}/delete`, { ids: part });
    }
  },

  async getPartners() {
    const { state } = await api<{ state: PartnerState | null }>('GET', '/api/partners');
    return state;
  },

  async putPartners(state) {
    await api('PUT', '/api/partners', { state });
  },
};

const noopRemote: SyncRemote = {
  listRows: async () => [],
  fetchData: async () => [],
  upsert: async () => {},
  markDeleted: async () => {},
  getPartners: async () => null,
  putPartners: async () => {},
};

export const cloudSync = new SyncEngine(isServerConfigured ? serverRemote : noopRemote, {
  listWalks,
  getWalk,
  saveWalk,
  deleteWalk,
  listRoutes: listSavedRoutes,
  replaceRoutes: replaceSavedRoutes,
  loadPartners: loadPartnerState,
  savePartners: savePartnerState,
});
