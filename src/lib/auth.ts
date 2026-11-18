/**
 * Google 로그인 (Google Identity Services, 서버 없이 브라우저에서만 동작).
 *
 * - `VITE_GOOGLE_CLIENT_ID` 환경 변수에 OAuth 2.0 웹 클라이언트 ID를 넣으면 활성화된다.
 * - 로그인하면 Google이 준 ID 토큰(JWT)에서 이름·이메일·프로필 사진만 꺼내 이 기기에 저장한다.
 * - 백엔드가 없으므로 토큰 서명 검증은 하지 않는다. 이 정보는 화면 표시용(내 계정 표시)으로만 쓰고,
 *   권한 판단에 쓰지 않는다. 산책 기록은 지금처럼 이 기기에만 남는다.
 */

export interface AuthUser {
  /** Google 계정 고유 ID (JWT `sub`) */
  id: string;
  name: string;
  email: string;
  picture: string | null;
  /** 로그인한 시각 (ms) */
  signedInAt: number;
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

let initializedFor: string | null = null;
let credentialHandler: ((res: GsiCredentialResponse) => void) | null = null;

/**
 * GIS를 불러와 초기화하고 `parent`에 Google 공식 로그인 버튼을 그린다.
 * 로그인에 성공하면 `onSignIn`이 사용자 정보와 함께 호출된다.
 */
export async function renderGoogleButton(
  parent: HTMLElement,
  onSignIn: (user: AuthUser) => void,
  onError: (msg: string) => void,
  clientId: string = GOOGLE_CLIENT_ID,
): Promise<void> {
  const gsi = await loadGoogleIdentity();
  credentialHandler = (res) => {
    const user = parseGoogleCredential(res?.credential ?? '');
    if (user) onSignIn(user);
    else onError('Google 로그인 정보를 읽지 못했어요. 다시 시도해 주세요.');
  };
  if (initializedFor !== clientId) {
    gsi.initialize({
      client_id: clientId,
      callback: (res) => credentialHandler?.(res),
      auto_select: false,
      cancel_on_tap_outside: true,
      ux_mode: 'popup',
    });
    initializedFor = clientId;
  }
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

/** 로그아웃: 저장된 정보를 지우고 다음 방문 때 자동 로그인되지 않게 한다. */
export function signOutGoogle(): void {
  saveAuthUser(null);
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    /* 스크립트를 안 불러온 상태면 무시 */
  }
}
