import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { jwtVerify } from 'jose';
import { appConfig } from '../../config/configuration';
import { AuthenticatedUser, IS_PUBLIC_KEY } from './authenticated-user';

/**
 * Verifies the Bearer access token (HS256) and attaches the AuthenticatedUser.
 * Applied globally; routes opt out with @Public(). The userId comes ONLY from
 * the verified token — never from the request body/query (handoff §9).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: Uint8Array;

  constructor(
    private readonly reflector: Reflector,
    @Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>,
  ) {
    this.secret = new TextEncoder().encode(cfg.jwt.accessSecret);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.cfg.appBaseUrl,
        audience: 'fieldnote-app',
      });
      if (payload.type !== 'access' || typeof payload.sub !== 'string') {
        throw new UnauthorizedException('Invalid access token.');
      }
      const appleSub = typeof payload.appleSub === 'string' ? payload.appleSub : '';
      request.user = { userId: payload.sub, appleSub };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
