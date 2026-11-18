import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

function b64url(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const jwt = (payload: unknown) => `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

describe('auth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('parses a Google ID token payload (with Korean name)', async () => {
    const { parseGoogleCredential } = await import('./auth');
    const u = parseGoogleCredential(
      jwt({ sub: '123', name: '홍길동', email: 'a@example.com', picture: 'https://x/p.png' }),
      42,
    );
    expect(u).toEqual({
      id: '123',
      name: '홍길동',
      email: 'a@example.com',
      picture: 'https://x/p.png',
      signedInAt: 42,
    });
  });

  it('falls back to the email local part when name is missing', async () => {
    const { parseGoogleCredential } = await import('./auth');
    const u = parseGoogleCredential(jwt({ sub: '1', email: 'walker@example.com' }));
    expect(u?.name).toBe('walker');
    expect(u?.picture).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    const { parseGoogleCredential } = await import('./auth');
    expect(parseGoogleCredential('')).toBeNull();
    expect(parseGoogleCredential('a.b')).toBeNull();
    expect(parseGoogleCredential('a.!!!.c')).toBeNull();
    expect(parseGoogleCredential(jwt({ name: 'no sub' }))).toBeNull();
  });

  it('saves, loads and clears the signed-in user', async () => {
    const { loadAuthUser, saveAuthUser, signOutGoogle } = await import('./auth');
    expect(loadAuthUser()).toBeNull();
    const user = { id: '9', name: 'N', email: 'n@example.com', picture: null, signedInAt: 1 };
    saveAuthUser(user);
    expect(loadAuthUser()).toEqual({ ...user, cloud: false });
    await signOutGoogle();
    expect(loadAuthUser()).toBeNull();
  });

  it('ignores corrupted stored data', async () => {
    localStorage.setItem('walkdraw.auth.v1', '{not json');
    const { loadAuthUser } = await import('./auth');
    expect(loadAuthUser()).toBeNull();
  });

  it('maps a server user to a profile', async () => {
    const { userFromServer } = await import('./auth');
    expect(userFromServer({ id: 3, email: 'a@example.com', name: '김산책', picture: null }, 7)).toEqual({
      id: '3',
      name: '김산책',
      email: 'a@example.com',
      picture: null,
      signedInAt: 7,
      cloud: true,
    });
    expect(userFromServer({ id: 4, email: 'walker@example.com', name: '', picture: '' }).name).toBe('walker');
  });

  it('is not configured without a client id', async () => {
    const { isGoogleLoginConfigured } = await import('./auth');
    expect(isGoogleLoginConfigured('')).toBe(false);
    expect(isGoogleLoginConfigured('id.apps.googleusercontent.com')).toBe(true);
  });
});
