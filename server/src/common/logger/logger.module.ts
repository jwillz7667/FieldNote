import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { IncomingMessage, ServerResponse } from 'node:http';
import { appConfig } from '../../config/configuration';
import { ConfigModule } from '../../config/config.module';

/**
 * Structured logging with a request id on every line (handoff §5). The auth
 * header is redacted so bearer tokens never hit the logs. Pretty output in dev,
 * raw JSON in prod (so Railway/log shippers parse it).
 *
 * `pino-pretty` is a devDependency and is stripped from the production image by
 * `npm prune --omit=dev`. Keying the transport on `NODE_ENV` alone is therefore
 * unsafe: a pruned image booted with a non-production `NODE_ENV` would ask pino
 * to load a target that isn't installed and crash at startup ("unable to
 * determine transport target for pino-pretty"). We additionally require the
 * module to be resolvable, so a lean runtime image always degrades to JSON
 * instead of failing to boot.
 */
const isPrettyTransportAvailable = ((): boolean => {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
})();

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [appConfig.KEY],
      useFactory: (cfg: ConfigType<typeof appConfig>) => ({
        pinoHttp: {
          level: cfg.logLevel,
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const existing = req.headers['x-request-id'];
            const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            remove: true,
          },
          autoLogging: true,
          transport:
            cfg.isProduction || !isPrettyTransportAvailable
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
        },
      }),
    }),
  ],
})
export class LoggerModule {}
