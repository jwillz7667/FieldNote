import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from './authenticated-user';

/**
 * Injects the authenticated user established by JwtAuthGuard. Throws if absent —
 * a controller using this on an unguarded route is a programming error, not a
 * client error we want to mask.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new UnauthorizedException('Authentication required.');
    }
    return request.user;
  },
);
