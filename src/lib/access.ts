import type { AccessIdentity, Env } from '../types';

interface AccessClaims {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iss?: string;
  nbf?: number;
  sub?: string;
}

interface AccessHeader {
  alg?: string;
  kid?: string;
}

interface CachedCertificates {
  fetchedAt: number;
  keys: Array<JsonWebKey & { kid?: string }>;
}

const CERTIFICATE_TTL_MS = 10 * 60 * 1000;
let certificateCache: CachedCertificates | null = null;
let certificateFetch: Promise<CachedCertificates> | null = null;

function normaliseTeamDomain(value: string): string {
  return value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
  } catch {
    return null;
  }
}

async function loadCertificates(teamDomain: string): Promise<CachedCertificates> {
  const now = Date.now();
  if (certificateCache && now - certificateCache.fetchedAt < CERTIFICATE_TTL_MS) return certificateCache;

  if (!certificateFetch) {
    certificateFetch = (async () => {
      const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Access certificate endpoint returned ${response.status}`);

      const body = (await response.json()) as
        | { keys?: Array<JsonWebKey & { kid?: string }> }
        | Array<JsonWebKey & { kid?: string }>;
      const keys = Array.isArray(body) ? body : body.keys;
      if (!keys?.length) throw new Error('Access certificate response contained no keys');

      const fresh: CachedCertificates = { fetchedAt: Date.now(), keys };
      certificateCache = fresh;
      return fresh;
    })().finally(() => {
      certificateFetch = null;
    });
  }

  return certificateFetch;
}

function hasAudience(claim: AccessClaims, expected: string): boolean {
  return Array.isArray(claim.aud) ? claim.aud.includes(expected) : claim.aud === expected;
}

/** Whether the Worker has enough configuration to verify Access JWTs. */
export function isAccessConfigured(env: Env): boolean {
  return Boolean(normaliseTeamDomain(env.ACCESS_TEAM_DOMAIN) && env.ACCESS_AUD.trim());
}

/** Verify the JWT that Cloudflare Access adds to requests. */
export async function verifyAccessJwt(request: Request, env: Env): Promise<AccessIdentity | null> {
  if (!isAccessConfigured(env)) return null;

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodeJson<AccessHeader>(encodedHeader);
  const claims = decodeJson<AccessClaims>(encodedClaims);
  if (!header || !claims || header.alg !== 'RS256' || !header.kid) return null;

  const teamDomain = normaliseTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const issuer = `https://${teamDomain}`;
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== issuer) return null;
  if (!hasAudience(claims, env.ACCESS_AUD.trim())) return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  if (typeof claims.nbf === 'number' && claims.nbf > now) return null;

  try {
    const certificates = await loadCertificates(teamDomain);
    const jwk = certificates.keys.find((key) => key.kid === header.kid);
    if (!jwk) return null;

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      decodeBase64Url(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
    );
    if (!valid || !claims.email || !claims.sub?.trim()) return null;

    return {
      email: claims.email.trim().toLowerCase(),
      sub: claims.sub.trim(),
      aud: env.ACCESS_AUD.trim(),
    };
  } catch {
    // Authentication failures are intentionally indistinguishable from a
    // missing/expired token to avoid turning this endpoint into an oracle.
    return null;
  }
}
