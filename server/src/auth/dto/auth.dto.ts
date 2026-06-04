import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AppleSignInDto {
  @ApiProperty({ description: "Apple's identity token (JWT) from ASAuthorizationAppleIDCredential." })
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  identityToken!: string;

  @ApiPropertyOptional({ description: 'Raw nonce the client set on the authorization request (replay protection).' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  nonce?: string;

  @ApiPropertyOptional({ description: 'Email from the Apple credential (only present on first sign-in).' })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refreshToken!: string;
}

export class TokenResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ enum: ['Bearer'], default: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ description: 'Access token lifetime in seconds.' })
  expiresIn!: number;

  @ApiProperty()
  userId!: string;
}
