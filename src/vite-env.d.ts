/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth 2.0 웹 클라이언트 ID (예: 1234-abc.apps.googleusercontent.com) */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
