import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { appConfig } from '../config/configuration';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { APPLE_TOKEN_VERIFIER, AppleTokenVerifier } from './apple/apple-token-verifier';
import { DevAppleTokenVerifier } from './apple/dev-apple-verifier';
import { RealAppleTokenVerifier } from './apple/real-apple-verifier';
import { TokenService } from './token.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    {
      provide: APPLE_TOKEN_VERIFIER,
      inject: [appConfig.KEY],
      useFactory: (cfg: ConfigType<typeof appConfig>): AppleTokenVerifier =>
        cfg.apple.devBypass
          ? new DevAppleTokenVerifier()
          : new RealAppleTokenVerifier(cfg.apple.clientId),
    },
  ],
  exports: [TokenService],
})
export class AuthModule {}
