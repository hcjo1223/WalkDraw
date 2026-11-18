/**
 * WalkDraw API 클라이언트 (OCI 서버: server/).
 * `VITE_API_URL`이 없으면 null 취급 — 앱은 기기 저장만으로 동작한다.
 */
export const API_URL: string = (import.meta.env?.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
export const isServerConfigured = API_URL.length > 0;

const TOKEN_KEY = 'walkdraw.session.v1';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const unauthorizedListeners = new Set<() => void>();

/** 세션이 만료·취소되어 401을 받으면 호출된다 */
export function onUnauthorized(cb: () => void): () => void {
  unauthorizedListeners.add(cb);
  return () => unauthorizedListeners.delete(cb);
}

export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  opts: { auth?: boolean } = {},
): Promise<T> {
  if (!isServerConfigured) throw new ApiError(0, '서버가 설정되지 않았어요');
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const token = getToken();
    if (!token) throw new ApiError(401, '로그인이 필요해요');
    headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했어요');
  }
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* 비 JSON 응답 */
  }
  if (!res.ok) {
    const msg = (json as { error?: string } | undefined)?.error ?? `서버 오류 (${res.status})`;
    if (res.status === 401 && opts.auth !== false) {
      setToken(null);
      unauthorizedListeners.forEach((l) => l());
    }
    throw new ApiError(res.status, msg);
  }
  return json as T;
}
