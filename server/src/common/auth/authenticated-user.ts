/** Identity attached to the request by JwtAuthGuard after verifying the access token. */
export interface AuthenticatedUser {
  /** Internal User.id (uuid) — the trust anchor for per-user scoping. Never client-supplied. */
  userId: string;
  appleSub: string;
}

export const IS_PUBLIC_KEY = 'isPublic';
