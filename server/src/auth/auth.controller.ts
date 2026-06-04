import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/auth/public.decorator';
import { AuthService } from './auth.service';
import { AppleSignInDto, RefreshDto, TokenResponseDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
// Tight rate limit on auth (handoff §5): 10 requests / minute / IP.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('apple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange an Apple identity token for app tokens.' })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  signInWithApple(@Body() dto: AppleSignInDto): Promise<TokenResponseDto> {
    return this.auth.signInWithApple(dto.identityToken, dto.nonce, dto.email);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate tokens using a valid refresh token.' })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  refresh(@Body() dto: RefreshDto): Promise<TokenResponseDto> {
    return this.auth.refresh(dto.refreshToken);
  }
}
