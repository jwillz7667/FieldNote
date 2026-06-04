import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { decodeJwt } from 'jose';
import { AppleIdentity, AppleTokenVerifier } from './apple-token-verifier';

/**
 * Local/dev-only verifier (APPLE_AUTH_DEV_BYPASS=true). It does NOT verify a
 * signature — it derives a stable identity from whatever the client sends so the
 * full device flow can be exercised without Apple credentials. The env schema
 * forbids enabling this in production.
 *
 * Accepts either a JWT (claims are read, not verified) or a bare string, which
 * is treated as the appleSub directly — convenient for manual API testing.
 */
export class DevAppleTokenVerifier implements AppleTokenVerifier {
  private readonly logger = new Logger('DevAppleTokenVerifier');

  verify(identityToken: string): Promise<AppleIdentity> {
    this.logger.warn('Using DEV Apple verifier — signatures are NOT checked. Never enable in production.');

    let sub: string | undefined;
    let email: string | undefined;
    try {
      const claims = decodeJwt(identityToken);
      sub = typeof claims.sub === 'string' ? claims.sub : undefined;
      email = typeof claims.email === 'string' ? claims.email : undefined;
    } catch {
      // Not a JWT — treat the raw token as the subject for easy manual testing.
    }

    if (!sub) {
      sub = `dev-${createHash('sha256').update(identityToken).digest('hex').slice(0, 32)}`;
    }

    return Promise.resolve({
      sub,
      email,
      emailVerified: true,
      isPrivateEmail: false,
    });
  }
}
