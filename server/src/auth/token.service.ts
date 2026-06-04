import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { SignJWT } from 'jose';
import { appConfig } from '../config/configuration';

const JWT_AUDIENCE = 'fieldnote-app';

export interface AccessTokenClaims {
  userId: string;
  appleSub: string;
}

/**
 * Issues stateless access JWTs (HS256, verified by JwtAuthGuard) and opaque
 * refresh tokens. Refresh tokens are random secrets; only a keyed HMAC-SHA256 of
 * the token (peppered with JWT_REFRESH_SECRET) is persisted, so a DB leak alone
 * can neither replay nor precompute them (handoff §9, rotation).
 */
@Injectable()
export class TokenService {
  private readonly accessKey: Uint8Array;

  constructor(@Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>) {
    this.accessKey = new TextEncoder().encode(cfg.jwt.accessSecret);
  }

  get accessTtlSeconds(): number {
    return this.cfg.jwt.accessTtl;
  }

  get refreshTtlSeconds(): number {
    return this.cfg.jwt.refreshTtl;
  }

  async issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ type: 'access', appleSub: claims.appleSub })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setIssuer(this.cfg.appBaseUrl)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + this.cfg.jwt.accessTtl)
      .sign(this.accessKey);
  }

  /** Returns the raw token (handed to the client once) and the hash we persist. */
  generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(48).toString('base64url');
    return {
      token,
      hash: this.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + this.cfg.jwt.refreshTtl * 1000),
    };
  }

  hashRefreshToken(token: string): string {
    return createHmac('sha256', this.cfg.jwt.refreshSecret).update(token).digest('hex');
  }
}
