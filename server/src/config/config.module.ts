import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { appConfig } from './configuration';

/**
 * Global config. Loads .env (dev/test convenience; prod uses real env vars) and
 * exposes the validated, namespaced `app` config. The factory throws on invalid
 * env so the process aborts at boot rather than failing on first request.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Prod injects real env vars; .env is for local/dev/test only.
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      envFilePath: ['.env'],
      load: [appConfig],
      expandVariables: true,
    }),
  ],
})
export class ConfigModule {}
