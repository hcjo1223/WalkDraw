/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth 2.0 웹 클라이언트 ID (예: 1234-abc.apps.googleusercontent.com) */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** 로그인·동기화 API 주소 (예: https://walkdraw.129.203.174.119.sslip.io) */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
