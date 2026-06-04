import { z } from 'zod';

/**
 * Boot-time environment contract. The process REFUSES TO START if anything here
 * is missing or malformed (handoff §0/§5 — fail-fast config). Cross-field rules
 * (e.g. "Deepgram key required unless mock AI") live in the superRefine below so
 * a misconfigured deploy fails at boot, not at the first request.
 */

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter((s) => s.length > 0));

const rawSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8080),
    APP_BASE_URL: z.string().url(),
    CORS_ORIGINS: csv.default('*'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().min(1).startsWith('postgres'),
    REDIS_URL: z.string().min(1).startsWith('redis'),

    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    R2_ENDPOINT: z.string().url(),
    R2_FORCE_PATH_STYLE: boolish.default(false),
    R2_PRESIGN_PUT_TTL: z.coerce.number().int().positive().max(7 * 24 * 3600).default(3600),
    R2_PRESIGN_GET_TTL: z.coerce.number().int().positive().max(7 * 24 * 3600).default(900),
    AUDIO_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(30),

    TRANSCRIPTION_PROVIDER: z.enum(['deepgram', 'openai']).default('deepgram'),
    DEEPGRAM_API_KEY: z.string().optional().default(''),
    DEEPGRAM_MODEL: z.string().min(1).default('nova-3'),
    OPENAI_API_KEY: z.string().optional().default(''),
    OPENAI_TRANSCRIBE_MODEL: z.string().min(1).default('gpt-4o-mini-transcribe'),
    DEEPSEEK_API_KEY: z.string().optional().default(''),
    DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
    REPORT_MODEL: z.string().min(1).default('deepseek-chat'),

    MAX_AUDIO_SECONDS: z.coerce.number().int().positive().default(5400),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().max(50).default(2),
    STAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
    JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(3),
    USE_MOCK_AI: boolish.default(false),

    APPLE_TEAM_ID: z.string().optional().default(''),
    APPLE_KEY_ID: z.string().optional().default(''),
    APPLE_CLIENT_ID: z.string().min(1),
    APPLE_PRIVATE_KEY: z.string().optional().default(''),
    APPLE_AUTH_DEV_BYPASS: boolish.default(false),

    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),

    BULL_BOARD_USER: z.string().optional().default(''),
    BULL_BOARD_PASSWORD: z.string().optional().default(''),
  })
  .superRefine((env, ctx) => {
    const mockAi = env.USE_MOCK_AI || env.NODE_ENV === 'test';
    const prod = env.NODE_ENV === 'production';

    if (!mockAi) {
      if (env.TRANSCRIPTION_PROVIDER === 'deepgram' && !env.DEEPGRAM_API_KEY) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DEEPGRAM_API_KEY'], message: 'required when TRANSCRIPTION_PROVIDER=deepgram and USE_MOCK_AI is false' });
      }
      if (env.TRANSCRIPTION_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['OPENAI_API_KEY'], message: 'required when TRANSCRIPTION_PROVIDER=openai and USE_MOCK_AI is false' });
      }
      if (!env.DEEPSEEK_API_KEY) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DEEPSEEK_API_KEY'], message: 'required for report compilation when USE_MOCK_AI is false' });
      }
    }

    if (prod && env.APPLE_AUTH_DEV_BYPASS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['APPLE_AUTH_DEV_BYPASS'], message: 'must be false in production' });
    }
    if (!env.APPLE_AUTH_DEV_BYPASS) {
      for (const key of ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'required unless APPLE_AUTH_DEV_BYPASS=true' });
        }
      }
    }
    if (prod) {
      for (const [key, val] of [
        ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
        ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
      ] as const) {
        if (val.includes('change-me')) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'must not use the placeholder secret in production' });
        }
      }
      // The access secret signs stateless JWTs; the refresh secret peppers the
      // stored refresh-token hash. Reusing one value collapses both blast radii.
      if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_ACCESS_SECRET in production' });
      }
      // A wildcard CORS origin in production lets any site script the API on a
      // user's behalf — require an explicit allow-list.
      if (env.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ORIGINS'], message: 'must be an explicit allow-list in production (wildcard not allowed)' });
      }
    }
  });

export type RawEnv = z.infer<typeof rawSchema>;

/** Structured, nested, frozen config consumed across the app. */
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  isTest: boolean;
  port: number;
  appBaseUrl: string;
  corsOrigins: string[];
  logLevel: RawEnv['LOG_LEVEL'];
  database: { url: string };
  redis: { url: string };
  r2: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint: string;
    forcePathStyle: boolean;
    presignPutTtl: number;
    presignGetTtl: number;
    audioRetentionDays: number;
  };
  ai: {
    useMock: boolean;
    transcriptionProvider: 'deepgram' | 'openai';
    deepgramApiKey: string;
    deepgramModel: string;
    openaiApiKey: string;
    openaiTranscribeModel: string;
    deepseekApiKey: string;
    deepseekBaseUrl: string;
    reportModel: string;
    maxAudioSeconds: number;
    workerConcurrency: number;
    stageTimeoutMs: number;
    jobMaxAttempts: number;
  };
  apple: {
    teamId: string;
    keyId: string;
    clientId: string;
    privateKey: string;
    devBypass: boolean;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: number;
    refreshTtl: number;
  };
  bullBoard: { user: string; password: string; enabled: boolean };
}

/**
 * Parse + validate raw env into a frozen AppConfig. Throws a single readable
 * error listing every problem (so a misconfigured deploy fails loudly at boot).
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const useMock = e.USE_MOCK_AI || e.NODE_ENV === 'test';

  const cfg: AppConfig = {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    appBaseUrl: e.APP_BASE_URL,
    corsOrigins: e.CORS_ORIGINS,
    logLevel: e.LOG_LEVEL,
    database: { url: e.DATABASE_URL },
    redis: { url: e.REDIS_URL },
    r2: {
      accountId: e.R2_ACCOUNT_ID,
      accessKeyId: e.R2_ACCESS_KEY_ID,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY,
      bucket: e.R2_BUCKET,
      endpoint: e.R2_ENDPOINT,
      forcePathStyle: e.R2_FORCE_PATH_STYLE,
      presignPutTtl: e.R2_PRESIGN_PUT_TTL,
      presignGetTtl: e.R2_PRESIGN_GET_TTL,
      audioRetentionDays: e.AUDIO_RETENTION_DAYS,
    },
    ai: {
      useMock,
      transcriptionProvider: e.TRANSCRIPTION_PROVIDER,
      deepgramApiKey: e.DEEPGRAM_API_KEY,
      deepgramModel: e.DEEPGRAM_MODEL,
      openaiApiKey: e.OPENAI_API_KEY,
      openaiTranscribeModel: e.OPENAI_TRANSCRIBE_MODEL,
      deepseekApiKey: e.DEEPSEEK_API_KEY,
      deepseekBaseUrl: e.DEEPSEEK_BASE_URL,
      reportModel: e.REPORT_MODEL,
      maxAudioSeconds: e.MAX_AUDIO_SECONDS,
      workerConcurrency: e.WORKER_CONCURRENCY,
      stageTimeoutMs: e.STAGE_TIMEOUT_MS,
      jobMaxAttempts: e.JOB_MAX_ATTEMPTS,
    },
    apple: {
      teamId: e.APPLE_TEAM_ID,
      keyId: e.APPLE_KEY_ID,
      clientId: e.APPLE_CLIENT_ID,
      privateKey: e.APPLE_PRIVATE_KEY,
      devBypass: e.APPLE_AUTH_DEV_BYPASS,
    },
    jwt: {
      accessSecret: e.JWT_ACCESS_SECRET,
      refreshSecret: e.JWT_REFRESH_SECRET,
      accessTtl: e.JWT_ACCESS_TTL,
      refreshTtl: e.JWT_REFRESH_TTL,
    },
    bullBoard: {
      user: e.BULL_BOARD_USER,
      password: e.BULL_BOARD_PASSWORD,
      enabled: Boolean(e.BULL_BOARD_USER && e.BULL_BOARD_PASSWORD),
    },
  };
  return Object.freeze(cfg);
}
