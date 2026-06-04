import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { APPLE_TOKEN_VERIFIER, AppleTokenVerifier } from './apple/apple-token-verifier';
import { TokenResponseDto } from './dto/auth.dto';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    @Inject(APPLE_TOKEN_VERIFIER) private readonly appleVerifier: AppleTokenVerifier,
  ) {}

  /** Verify Apple → upsert user → issue access + (rotating) refresh tokens. */
  async signInWithApple(identityToken: string, nonce?: string, email?: string): Promise<TokenResponseDto> {
    const identity = await this.appleVerifier.verify(identityToken, nonce);
    const user = await this.users.upsertByApple(identity.sub, identity.email ?? email ?? null);
    this.logger.log({ userId: user.id }, 'Apple sign-in succeeded');
    return this.issueTokenPair(user.id, user.appleSub);
  }

  /**
   * Rotate a refresh token. Single-use: the presented token is revoked and a new
   * one issued. Presenting an already-revoked token is a theft signal — we revoke
   * the user's entire active chain and reject (handoff §9 rotation).
   */
  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });

    if (!record) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (record.revokedAt) {
      this.logger.warn({ userId: record.userId }, 'Refresh token reuse detected — revoking chain');
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token already used.');
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired.');
    }

    const user = await this.users.findById(record.userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists.');
    }

    const next = this.tokens.generateRefreshToken();
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { tokenHash: hash },
        data: { revokedAt: new Date(), replacedByTokenHash: next.hash },
      }),
      this.prisma.refreshToken.create({
        data: { userId: user.id, tokenHash: next.hash, expiresAt: next.expiresAt },
      }),
    ]);

    const accessToken = await this.tokens.issueAccessToken({ userId: user.id, appleSub: user.appleSub });
    return {
      accessToken,
      refreshToken: next.token,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSeconds,
      userId: user.id,
    };
  }

  private async issueTokenPair(userId: string, appleSub: string): Promise<TokenResponseDto> {
    const refresh = this.tokens.generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
    });
    const accessToken = await this.tokens.issueAccessToken({ userId, appleSub });
    return {
      accessToken,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSeconds,
      userId,
    };
  }
}
