import { registerAs } from '@nestjs/config';
import { loadConfig } from './env';

/**
 * Namespaced config factory. Runs after @nestjs/config has loaded the .env file,
 * so process.env is populated. Throws on invalid env → Nest aborts boot.
 *
 * Inject anywhere with:
 *   constructor(@Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>) {}
 */
export const appConfig = registerAs('app', () => loadConfig(process.env));
