// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoKnownInsecureSecretInProduction, isKnownInsecureSecret } from './secrets.js';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('secret hardening helpers', () => {
  it('recognizes public placeholder secrets', () => {
    expect(isKnownInsecureSecret('change-me-in-production')).toBe(true);
    expect(isKnownInsecureSecret(' dev-secret-change-in-production ')).toBe(true);
    expect(isKnownInsecureSecret('CHANGE_ME_TO_A_SECURE_RANDOM_STRING')).toBe(true);
    expect(isKnownInsecureSecret('your-session-secret')).toBe(true);
  });

  it('allows non-placeholder values', () => {
    expect(isKnownInsecureSecret('random-64-byte-secret-value')).toBe(false);
    expect(isKnownInsecureSecret(undefined)).toBe(false);
  });

  it('throws for known placeholders in production only', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNoKnownInsecureSecretInProduction('SESSION_SECRET', 'change-me-in-production'))
      .toThrow(/SESSION_SECRET/);

    process.env.NODE_ENV = 'development';
    expect(() => assertNoKnownInsecureSecretInProduction('SESSION_SECRET', 'change-me-in-production'))
      .not.toThrow();
  });
});
