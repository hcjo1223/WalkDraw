/**
 * Google 로그인 (Google Identity Services 버튼 + WalkDraw API 서버).
 *
 * - `VITE_GOOGLE_CLIENT_ID`에 OAuth 2.0 웹 클라이언트 ID를 넣으면 로그인 버튼이 활성화된다.
 * - 서버(`VITE_API_URL`, 저장소의 server/)가 설정돼 있으면 Google ID 토큰을 서버로 보내
 *   **서버가 Google 공개키로 검증**한 뒤 세션 토큰을 발급하고, 그 세션으로 기록을 동기화한다(lib/sync.ts).
 * - 서버가 없으면 예전처럼 토큰에서 이름·이메일·사진만 읽어 이 기기에만 저장한다(표시용).
 */
import { api, ApiError, getToken, isServerConfigured, onUnauthorized, setToken } from './api';

export interface AuthUser {
  /** 서버 연결 시 서버 사용자 ID, 아니면 Google 계정 ID (JWT `sub`) */
  id: string;
  name: string;
  email: string;
  picture: string | null;
  /** 로그인한 시각 (ms) */
  signedInAt: number;
  /** 서버 세션으로 로그인했는지 여부 — true면 기록이 동기화된다 */
  cloud?: boolean;
}

const LS_KEY = 'walkdraw.auth.v1';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

export const GOOGLE_CLIENT_ID: string = (import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? '').trim();

export function isGoogleLoginConfigured(clientId: string = GOOGLE_CLIENT_ID): boolean {
  return clientId.length > 0;
}

/** base64url 문자열을 UTF-8 텍스트로 디코딩 (한글 이름 대응) */
function base64UrlDecode(input: string): string {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad === 2) b64 += '==';
  else if (pad === 3) b64 += '=';
  else if (pad === 1) throw new Error('invalid-base64url');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Google ID 토큰(JWT)의 payload를 읽어 사용자 정보로 바꾼다. 형식이 틀리면 null. */
export function parseGoogleCredential(credential: string, now: number = Date.now()): AuthUser | null {
  const parts = credential.split('.');
  if (parts.length !== 3) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const sub = payload.sub;
  if (typeof sub !== 'string' || !sub) return null;
  const email = typeof payload.email === 'string' ? payload.email : '';
  const name =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : email
        ? email.split('@')[0]
        : 'Google 사용자';
  const picture = typeof payload.picture === 'string' && payload.picture ? payload.picture : null;
  return { id: sub, name, email, picture, signedInAt: now };
}

export function loadAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as Partial<AuthUser> | null;
    if (!u || typeof u.id !== 'string' || !u.id || typeof u.name !== 'string') return null;
    return {
      id: u.id,
      name: u.name,
      email: typeof u.email === 'string' ? u.email : '',
      picture: typeof u.picture === 'string' ? u.picture : null,
      signedInAt: typeof u.signedInAt === 'number' ? u.signedInAt : 0,
      cloud: u.cloud === true,
    };
  } catch {
    return null;
  }
}

export function saveAuthUser(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(LS_KEY, JSON.stringify(user));
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* 사생활 모드 등 — 이번 세션에서만 유지 */
  }
}

/** 서버가 돌려주는 사용자 */
export interface ServerUser {
  id: number | string;
  email: string;
  name: string;
  picture: string | null;
}

/** 서버 사용자 → 화면용 AuthUser */
export function userFromServer(user: ServerUser, now: number = Date.now()): AuthUser {
  const email = user.email ?? '';
  const name = user.name?.trim() || (email ? email.split('@')[0] : 'Google 사용자');
  return { id: String(user.id), name, email, picture: user.picture || null, signedInAt: now, cloud: true };
}

/** 앱 시작 시 저장된 서버 세션을 복원한다. 서버 미설정이면 기기 저장값을 그대로 쓴다. */
export async function restoreSession(): Promise<AuthUser | null> {
  const cached = loadAuthUser();
  if (!isServerConfigured) return cached;
  if (!getToken()) {
    // 세션이 없는데 서버 로그인 표시가 남아 있으면 정리
    if (cached?.cloud) {
      saveAuthUser(null);
      return null;
    }
    return cached;
  }
  try {
    const { user } = await api<{ user: ServerUser }>('GET', '/api/auth/me');
    const u = userFromServer(user, cached?.id === String(user.id) ? cached.signedInAt : Date.now());
    saveAuthUser(u);
    return u;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      saveAuthUser(null);
      return null;
    }
    return cached; // 오프라인 — 기기 저장값 사용, 다음에 다시 확인
  }
}

/** 서버 세션 만료·취소(401) 구독. 반환값은 구독 해제 함수 */
export function onServerSignOut(cb: () => void): () => void {
  return onUnauthorized(cb);
}

function friendlyAuthError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return '서버에 연결하지 못했어요. 네트워크를 확인해 주세요.';
    if (e.status === 401) return 'Google 로그인을 서버에서 확인하지 못했어요. (서버 GOOGLE_CLIENT_ID 설정 확인)';
    return `로그인에 실패했어요: ${e.message}`;
  }
  return `로그인에 실패했어요: ${e instanceof Error ? e.message : String(e)}`;
}

/* ---------- Google Identity Services 스크립트 ---------- */

interface GsiCredentialResponse {
  credential: string;
}

interface GsiButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
  locale?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (res: GsiCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    ux_mode?: 'popup' | 'redirect';
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: GsiButtonOptions): void;
  disableAutoSelect(): void;
  revoke?(hint: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

let gsiPromise: Promise<GoogleAccountsId> | null = null;

export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (gsiPromise) return gsiPromise;
  const p = new Promise<GoogleAccountsId>((resolve, reject) => {
    const ready = () => {
      const id = window.google?.accounts?.id;
      if (id) resolve(id);
      else reject(new Error('gsi-unavailable'));
    };
    if (window.google?.accounts?.id) {
      ready();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', () => reject(new Error('gsi-load-failed')), { once: true });
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  gsiPromise = p;
  p.catch(() => {
    gsiPromise = null;
  });
  return p;
}

/**
 * GIS를 불러와 초기화하고 `parent`에 Google 공식 로그인 버튼을 그린다.
 * 로그인에 성공하면 `onSignIn`이 사용자 정보와 함께 호출된다.
 * 서버가 설정돼 있으면 ID 토큰을 서버로 보내 검증·세션 발급까지 마친 뒤 호출된다.
 */
export async function renderGoogleButton(
  parent: HTMLElement,
  onSignIn: (user: AuthUser) => void,
  onError: (msg: string) => void,
  clientId: string = GOOGLE_CLIENT_ID,
  onPending?: () => void,
): Promise<void> {
  const gsi = await loadGoogleIdentity();
  gsi.initialize({
    client_id: clientId,
    auto_select: false,
    cancel_on_tap_outside: true,
    ux_mode: 'popup',
    callback: async (res) => {
      const credential = res?.credential ?? '';
      if (!isServerConfigured) {
        const user = parseGoogleCredential(credential);
        if (user) onSignIn(user);
        else onError('Google 로그인 정보를 읽지 못했어요. 다시 시도해 주세요.');
        return;
      }
      onPending?.();
      try {
        const { token, user } = await api<{ token: string; user: ServerUser }>(
          'POST',
          '/api/auth/google',
          { credential },
          { auth: false },
        );
        setToken(token);
        onSignIn(userFromServer(user));
      } catch (e) {
        onError(friendlyAuthError(e));
      }
    },
  });
  parent.replaceChildren();
  gsi.renderButton(parent, {
    type: 'standard',
    theme: 'filled_black',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'left',
    width: Math.min(300, Math.max(200, parent.clientWidth || 280)),
    locale: 'ko',
  });
}

/** 로그아웃: 서버 세션과 저장된 정보를 지우고 다음 방문 때 자동 로그인되지 않게 한다. */
export async function signOutGoogle(): Promise<void> {
  saveAuthUser(null);
  if (isServerConfigured && getToken()) {
    try {
      await api('POST', '/api/auth/logout');
    } catch {
      /* 오프라인이어도 기기 세션은 지운다 */
    }
  }
  setToken(null);
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    /* 스크립트를 안 불러온 상태면 무시 */
  }
}
