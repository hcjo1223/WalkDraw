/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth 2.0 웹 클라이언트 ID (예: 1234-abc.apps.googleusercontent.com) */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Supabase 프로젝트 URL (예: https://xxxx.supabase.co) */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable(anon) 키 — 브라우저 공개용 */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
