// Google ID 토큰 검증 — Google 공개키(JWKS)로 서명·발급자·대상(aud)·만료를 확인한다.
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/**
 * @param {string} clientId  Google OAuth 웹 클라이언트 ID (토큰의 aud와 같아야 함)
 * @returns {(credential: string) => Promise<{sub: string, email?: string, name?: string, picture?: string}>}
 */
export function googleVerifier(clientId) {
  return async (credential) => {
    const { payload } = await jwtVerify(credential, JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
    });
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('no-sub');
    if (payload.email && payload.email_verified === false) throw new Error('email-not-verified');
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      name: typeof payload.name === 'string' ? payload.name : '',
      picture: typeof payload.picture === 'string' ? payload.picture : null,
    };
  };
}
