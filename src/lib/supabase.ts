import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase 클라이언트 (서버: 로그인 검증 + 기록 동기화).
 * URL/키가 없으면 null — 앱은 지금처럼 기기 저장만으로 동작한다.
 */
const url = (import.meta.env?.VITE_SUPABASE_URL ?? '').trim();
const key = (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

export const supabase: SupabaseClient | null =
  url && key && typeof window !== 'undefined'
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'walkdraw.sb.auth',
        },
      })
    : null;

export const isServerConfigured = supabase !== null;
