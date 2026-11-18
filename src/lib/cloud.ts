/**
 * 앱에서 쓰는 동기화 싱글턴: Supabase 테이블 ↔ 기기 저장소.
 * 서버가 설정되지 않았으면 모든 호출이 아무 일도 하지 않는다.
 */
import { supabase } from './supabase';
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

const PAGE = 1000;
const FETCH_CHUNK = 50;
const UPSERT_CHUNK = 20;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase!.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('로그인이 만료됐어요. 다시 로그인해 주세요.');
  return id;
}

const supabaseRemote: SyncRemote = {
  async listRows(table: SyncTable): Promise<RemoteRow[]> {
    const rows: RemoteRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase!
        .from(table)
        .select('id, deleted')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as RemoteRow[]));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  },

  async fetchData<T>(table: SyncTable, ids: string[]): Promise<RemoteItem<T>[]> {
    const out: RemoteItem<T>[] = [];
    for (const part of chunk(ids, FETCH_CHUNK)) {
      const { data, error } = await supabase!.from(table).select('id, data').in('id', part);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as RemoteItem<T>[]));
    }
    return out;
  },

  async upsert(table, rows) {
    if (rows.length === 0) return;
    const userId = await currentUserId();
    for (const part of chunk(rows, UPSERT_CHUNK)) {
      const { error } = await supabase!.from(table).upsert(
        part.map((r) => ({
          user_id: userId,
          id: r.id,
          data: r.data,
          created_at: new Date(r.createdAt || Date.now()).toISOString(),
          deleted: false,
        })),
        { onConflict: 'user_id,id' },
      );
      if (error) throw new Error(error.message);
    }
  },

  async markDeleted(table, ids) {
    if (ids.length === 0) return;
    const userId = await currentUserId();
    for (const part of chunk(ids, UPSERT_CHUNK)) {
      // 데이터는 비우고 묘비만 남긴다 (다른 기기에서도 지우도록)
      const { error } = await supabase!.from(table).upsert(
        part.map((id) => ({ user_id: userId, id, data: {}, deleted: true })),
        { onConflict: 'user_id,id' },
      );
      if (error) throw new Error(error.message);
    }
  },

  async getPartners() {
    const { data, error } = await supabase!.from('partner_states').select('data').maybeSingle();
    if (error) throw new Error(error.message);
    const d = data?.data as Partial<PartnerState> | undefined;
    if (!d) return null;
    return {
      activeId: d.activeId ?? null,
      counts: d.counts ?? {},
      starterClaimed: Boolean(d.starterClaimed),
    };
  },

  async putPartners(state) {
    const userId = await currentUserId();
    const { error } = await supabase!
      .from('partner_states')
      .upsert({ user_id: userId, data: state }, { onConflict: 'user_id' });
    if (error) throw new Error(error.message);
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

export const cloudSync = new SyncEngine(supabase ? supabaseRemote : noopRemote, {
  listWalks,
  getWalk,
  saveWalk,
  deleteWalk,
  listRoutes: listSavedRoutes,
  replaceRoutes: replaceSavedRoutes,
  loadPartners: loadPartnerState,
  savePartners: savePartnerState,
});
