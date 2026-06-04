/** Verified identity extracted from an Apple identity token. */
export interface AppleIdentity {
  /** Apple's stable subject id for this (user, app) pair. The account anchor. */
  sub: string;
  email?: string;
  emailVerified: boolean;
  isPrivateEmail: boolean;
}

export interface AppleTokenVerifier {
  /**
   * Verify an Apple identity token and return the identity, or throw if the
   * token is invalid/expired or the nonce doesn't match.
   */
  verify(identityToken: string, expectedNonce?: string): Promise<AppleIdentity>;
}

export const APPLE_TOKEN_VERIFIER = Symbol('APPLE_TOKEN_VERIFIER');
