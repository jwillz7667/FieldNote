import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './swagger';

/**
 * Boots the app without listening, dumps the OpenAPI spec to ../openapi.json
 * (the contract the iOS client generates DTOs from — handoff §16), and exits.
 */
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  const document = buildOpenApiDocument(app);
  const outPath = resolve(__dirname, '../../openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2));
  await app.close();
  console.log(`Wrote ${outPath}`);
  process.exit(0);
}

void generate();
