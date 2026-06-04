import { timingSafeEqual } from 'node:crypto';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { Queue } from 'bullmq';
import { AppConfig } from '../config/env';
import { PROCESSING_QUEUE_TOKEN } from './queue.constants';
import { createBullConnection } from './redis.connection';
import { PROCESSING_DLQ } from './queue.constants';

const BASE_PATH = '/admin/queues';

/**
 * Mounts the Bull-Board dashboard for queue visibility (handoff §8 observability),
 * guarded by basic auth. No-op when BULL_BOARD_USER/PASSWORD are unset.
 */
export function mountBullBoard(app: INestApplication, cfg: AppConfig): void {
  if (!cfg.bullBoard.enabled) return;

  const mainQueue = app.get<Queue>(PROCESSING_QUEUE_TOKEN);
  const dlq = new Queue(PROCESSING_DLQ, { connection: createBullConnection(cfg.redis.url) });

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BASE_PATH);
  createBullBoard({
    queues: [new BullMQAdapter(mainQueue), new BullMQAdapter(dlq)],
    serverAdapter,
  });

  const basicAuth = (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
      // Constant-time compares so the dashboard credentials can't be recovered by
      // timing the per-character string comparison.
      if (safeEqual(user, cfg.bullBoard.user) && safeEqual(pass, cfg.bullBoard.password)) {
        next();
        return;
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="bull-board"').status(401).send('Authentication required.');
  };

  app.use(BASE_PATH, basicAuth, serverAdapter.getRouter());
}

/** Length-checked constant-time string compare (the length itself is not secret). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
