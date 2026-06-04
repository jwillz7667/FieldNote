import { loadConfig } from './env';

/**
 * A minimal env that passes validation: mock AI on (no provider keys needed) and
 * Apple dev-bypass on (no Apple signing keys needed). Tests clone this and mutate
 * single fields to exercise one rule at a time.
 */
function base(): Record<string, string> {
  return {
    NODE_ENV: 'development',
    APP_BASE_URL: 'http://localhost:8080',
    DATABASE_URL: 'postgresql://u:p@localhost:5544/fieldnote',
    REDIS_URL: 'redis://localhost:6399',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'fieldnote',
    R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    APPLE_CLIENT_ID: 'com.viralventures.fieldnote',
    JWT_ACCESS_SECRET: 'access-secret-0123456789abcdef',
    JWT_REFRESH_SECRET: 'refresh-secret-0123456789abcdef',
    USE_MOCK_AI: 'true',
    APPLE_AUTH_DEV_BYPASS: 'true',
  };
}

describe('loadConfig', () => {
  it('parses a valid env into a frozen, nested AppConfig with DeepSeek defaults', () => {
    const cfg = loadConfig(base());

    expect(cfg.isProduction).toBe(false);
    expect(cfg.ai.useMock).toBe(true);
    expect(cfg.ai.reportModel).toBe('deepseek-chat');
    expect(cfg.ai.deepseekBaseUrl).toBe('https://api.deepseek.com');
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('throws listing the offending key when a required var is missing', () => {
    const env = base();
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => loadConfig({ ...base(), DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });

  describe('AI provider key rules', () => {
    it('requires DEEPSEEK_API_KEY when USE_MOCK_AI is false', () => {
      const env = { ...base(), USE_MOCK_AI: 'false', DEEPSEEK_API_KEY: '' };
      expect(() => loadConfig(env)).toThrow(/DEEPSEEK_API_KEY/);
    });

    it('accepts a real DEEPSEEK_API_KEY with mock AI off', () => {
      const env = { ...base(), USE_MOCK_AI: 'false', DEEPSEEK_API_KEY: 'sk-deepseek-xyz', DEEPGRAM_API_KEY: 'dg-key' };
      const cfg = loadConfig(env);
      expect(cfg.ai.useMock).toBe(false);
      expect(cfg.ai.deepseekApiKey).toBe('sk-deepseek-xyz');
    });

    it('treats NODE_ENV=test as mock AI (no provider key required)', () => {
      const env = { ...base(), NODE_ENV: 'test', USE_MOCK_AI: 'false', DEEPSEEK_API_KEY: '' };
      const cfg = loadConfig(env);
      expect(cfg.isTest).toBe(true);
      expect(cfg.ai.useMock).toBe(true);
    });

    it('requires DEEPGRAM_API_KEY when the deepgram provider is live', () => {
      const env = { ...base(), USE_MOCK_AI: 'false', DEEPSEEK_API_KEY: 'k', TRANSCRIPTION_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: '' };
      expect(() => loadConfig(env)).toThrow(/DEEPGRAM_API_KEY/);
    });
  });

  describe('Apple auth rules', () => {
    it('requires Apple signing keys unless dev-bypass is on', () => {
      const env = { ...base(), APPLE_AUTH_DEV_BYPASS: 'false' };
      expect(() => loadConfig(env)).toThrow(/APPLE_TEAM_ID/);
    });

    it('forbids dev-bypass in production', () => {
      const env = { ...base(), NODE_ENV: 'production', USE_MOCK_AI: 'false', DEEPSEEK_API_KEY: 'k', APPLE_AUTH_DEV_BYPASS: 'true' };
      expect(() => loadConfig(env)).toThrow(/APPLE_AUTH_DEV_BYPASS/);
    });
  });

  describe('production hardening rules', () => {
    // A complete, valid production env. Individual tests break one rule at a time.
    function prodBase(): Record<string, string> {
      return {
        ...base(),
        NODE_ENV: 'production',
        USE_MOCK_AI: 'false',
        DEEPSEEK_API_KEY: 'k',
        DEEPGRAM_API_KEY: 'dg',
        APPLE_AUTH_DEV_BYPASS: 'false',
        APPLE_TEAM_ID: 'TEAM',
        APPLE_KEY_ID: 'KEY',
        APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
        CORS_ORIGINS: 'https://app.fieldnote.app',
      };
    }

    it('accepts a fully-configured production env', () => {
      const cfg = loadConfig(prodBase());
      expect(cfg.isProduction).toBe(true);
      expect(cfg.corsOrigins).toEqual(['https://app.fieldnote.app']);
    });

    it('rejects the placeholder secret in production', () => {
      expect(() => loadConfig({ ...prodBase(), JWT_ACCESS_SECRET: 'change-me-but-still-long-enough' })).toThrow(
        /JWT_ACCESS_SECRET/,
      );
    });

    it('rejects a wildcard CORS origin in production', () => {
      expect(() => loadConfig({ ...prodBase(), CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
    });

    it('rejects identical access and refresh secrets in production', () => {
      const env = {
        ...prodBase(),
        JWT_ACCESS_SECRET: 'shared-secret-0123456789abcdef',
        JWT_REFRESH_SECRET: 'shared-secret-0123456789abcdef',
      };
      expect(() => loadConfig(env)).toThrow(/JWT_REFRESH_SECRET/);
    });
  });
});
