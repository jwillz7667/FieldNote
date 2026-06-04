import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * Unit coverage for the refresh-token rotation + theft response in AuthService —
 * the security-critical path that the e2e suite (dev-bypass sign-in only) does
 * not exercise. A real TokenService is used so the HMAC hashing and rotation are
 * genuine; only the data store (Prisma) and collaborators are faked in-memory.
 */

interface RefreshRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenHash: string | null;
}

class FakePrisma {
  rows: RefreshRow[] = [];
  private seq = 0;

  refreshToken = {
    findUnique: ({ where: { tokenHash } }: { where: { tokenHash: string } }) =>
      Promise.resolve(this.rows.find((r) => r.tokenHash === tokenHash) ?? null),

    updateMany: ({
      where,
      data,
    }: {
      where: { userId: string; revokedAt: null };
      data: { revokedAt: Date };
    }) => {
      let count = 0;
      for (const r of this.rows) {
        if (r.userId === where.userId && r.revokedAt === null) {
          r.revokedAt = data.revokedAt;
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },

    update: ({
      where: { tokenHash },
      data,
    }: {
      where: { tokenHash: string };
      data: Partial<RefreshRow>;
    }) => {
      const row = this.rows.find((r) => r.tokenHash === tokenHash);
      if (!row) throw new Error('refreshToken.update: row not found');
      Object.assign(row, data);
      return Promise.resolve(row);
    },

    create: ({
      data,
    }: {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    }) => {
      this.seq += 1;
      const row: RefreshRow = {
        id: `rt_${this.seq}`,
        revokedAt: null,
        replacedByTokenHash: null,
        ...data,
      };
      this.rows.push(row);
      return Promise.resolve(row);
    },
  };

  // Operations are already eagerly evaluated (the fake mutates on call), so the
  // "transaction" only needs to await them together.
  $transaction = (ops: Array<Promise<unknown>>) => Promise.all(ops);
}

interface FakeUser {
  id: string;
  appleSub: string;
  email: string | null;
}

class FakeUsers {
  private byId = new Map<string, FakeUser>();
  private bySub = new Map<string, FakeUser>();

  seed(user: FakeUser): void {
    this.byId.set(user.id, user);
    this.bySub.set(user.appleSub, user);
  }

  remove(id: string): void {
    this.byId.delete(id);
  }

  upsertByApple = (appleSub: string, email: string | null) => {
    const existing = this.bySub.get(appleSub);
    if (existing) {
      existing.email = email ?? existing.email;
      return Promise.resolve(existing);
    }
    const user: FakeUser = { id: `user_${this.byId.size + 1}`, appleSub, email };
    this.seed(user);
    return Promise.resolve(user);
  };

  findById = (id: string) => Promise.resolve(this.byId.get(id) ?? null);
}

const cfg = {
  appBaseUrl: 'https://api.fieldnote.test',
  jwt: {
    accessSecret: 'unit-access-secret-unit-access-secret-unit-1',
    refreshSecret: 'unit-refresh-secret-unit-refresh-secret-unit',
    accessTtl: 900,
    refreshTtl: 60 * 60 * 24 * 30,
  },
};

function build() {
  const prisma = new FakePrisma();
  const users = new FakeUsers();
  const tokens = new TokenService(cfg as never);
  const appleVerifier = {
    verify: jest.fn().mockResolvedValue({ sub: 'apple-sub-1', email: 'a@b.com' }),
  };
  const service = new AuthService(
    prisma as never,
    users as never,
    tokens,
    appleVerifier,
  );
  return { service, prisma, users, tokens, appleVerifier };
}

describe('AuthService', () => {
  describe('signInWithApple', () => {
    it('verifies the identity token, upserts the user, and issues one active refresh token', async () => {
      const { service, prisma, users, appleVerifier } = build();

      const result = await service.signInWithApple('identity-token', 'nonce-123', 'fallback@b.com');

      expect(appleVerifier.verify).toHaveBeenCalledWith('identity-token', 'nonce-123');
      expect(result.tokenType).toBe('Bearer');
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.userId).toEqual(expect.any(String));
      expect(await users.findById(result.userId)).not.toBeNull();
      expect(prisma.rows).toHaveLength(1);
      expect(prisma.rows[0].revokedAt).toBeNull();
    });

    it('falls back to the supplied email when Apple omits one', async () => {
      const { service, users, appleVerifier } = build();
      appleVerifier.verify.mockResolvedValue({ sub: 'apple-sub-2', email: null });

      const result = await service.signInWithApple('t', undefined, 'fallback@b.com');

      const user = await users.findById(result.userId);
      expect(user?.email).toBe('fallback@b.com');
    });
  });

  describe('refresh', () => {
    it('rotates a valid token: revokes the presented one, issues a fresh usable one', async () => {
      const { service, prisma } = build();
      const first = await service.signInWithApple('t');

      const rotated = await service.refresh(first.refreshToken);

      expect(rotated.refreshToken).not.toBe(first.refreshToken);
      expect(rotated.accessToken).toEqual(expect.any(String));
      // Old row revoked and linked to its replacement; new row active.
      const active = prisma.rows.filter((r) => r.revokedAt === null);
      expect(active).toHaveLength(1);
      const revoked = prisma.rows.filter((r) => r.revokedAt !== null);
      expect(revoked).toHaveLength(1);
      expect(revoked[0].replacedByTokenHash).not.toBeNull();
      // The freshly issued token works for a subsequent rotation.
      await expect(service.refresh(rotated.refreshToken)).resolves.toMatchObject({
        tokenType: 'Bearer',
      });
    });

    it('rejects an unknown refresh token', async () => {
      const { service } = build();
      await expect(service.refresh('never-issued')).rejects.toThrow(UnauthorizedException);
    });

    it('treats reuse of a revoked token as theft and revokes the whole active chain', async () => {
      const { service, prisma } = build();
      const first = await service.signInWithApple('t');
      const rotated = await service.refresh(first.refreshToken); // first.refreshToken now revoked

      // Replaying the already-rotated (revoked) token is a theft signal.
      await expect(service.refresh(first.refreshToken)).rejects.toThrow('Refresh token already used.');

      // The entire active chain (including the legitimately-rotated token) is revoked.
      expect(prisma.rows.every((r) => r.revokedAt !== null)).toBe(true);
      await expect(service.refresh(rotated.refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired refresh token', async () => {
      const { service, prisma, users, tokens } = build();
      users.seed({ id: 'user_expired', appleSub: 'sub-x', email: null });
      const expiredToken = 'expired-raw-token';
      prisma.rows.push({
        id: 'rt_expired',
        userId: 'user_expired',
        tokenHash: tokens.hashRefreshToken(expiredToken),
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
        replacedByTokenHash: null,
      });

      await expect(service.refresh(expiredToken)).rejects.toThrow('Refresh token expired.');
    });

    it('rejects when the owning user no longer exists', async () => {
      const { service, users } = build();
      const first = await service.signInWithApple('t');
      users.remove(first.userId);

      await expect(service.refresh(first.refreshToken)).rejects.toThrow('User no longer exists.');
    });
  });
});
