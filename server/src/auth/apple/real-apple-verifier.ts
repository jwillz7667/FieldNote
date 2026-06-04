import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { AppleIdentity, AppleTokenVerifier } from './apple-token-verifier';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');

interface AppleIdTokenClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  nonce?: string;
  nonce_supported?: boolean;
}

/**
 * Verifies Apple identity tokens against Apple's rotating JWKS (handoff §9).
 * `createRemoteJWKSet` caches keys and transparently refetches on rotation, so
 * we never pin a stale signing key.
 */
export class RealAppleTokenVerifier implements AppleTokenVerifier {
  private readonly jwks = createRemoteJWKSet(APPLE_JWKS_URL, {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
  });

  constructor(private readonly clientId: string) {}

  async verify(identityToken: string, expectedNonce?: string): Promise<AppleIdentity> {
    let claims: AppleIdTokenClaims;
    try {
      const { payload } = await jwtVerify<AppleIdTokenClaims>(identityToken, this.jwks, {
        issuer: APPLE_ISSUER,
        audience: this.clientId,
      });
      claims = payload;
    } catch {
      throw new UnauthorizedException('Apple identity token failed verification.');
    }

    if (!claims.sub) {
      throw new UnauthorizedException('Apple identity token missing subject.');
    }

    // Replay protection is mandatory on the production path. The iOS client always
    // sets a nonce (SHA-256 in the Apple request, raw value to us — see SessionStore
    // / Nonce.swift), so a sign-in that omits it is a downgrade attempt, not a
    // legitimate client. Reject rather than silently skipping the check.
    if (!expectedNonce) {
      throw new UnauthorizedException('Apple sign-in is missing the required nonce.');
    }
    const hashed = createHash('sha256').update(expectedNonce).digest('hex');
    // Apple echoes the nonce the app set on the request. Apps may send it raw or
    // SHA-256-hashed; accept either to match the iOS client (§4 nonce flow).
    if (claims.nonce !== expectedNonce && claims.nonce !== hashed) {
      throw new UnauthorizedException('Apple identity token nonce mismatch.');
    }

    return {
      sub: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      isPrivateEmail: claims.is_private_email === true || claims.is_private_email === 'true',
    };
  }
}
