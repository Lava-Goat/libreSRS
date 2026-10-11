// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE

const KNOWN_INSECURE_SECRETS = new Set([
  'change-me',
  'change-me-in-production',
  'change_me_to_a_secure_random_string',
  'changeme',
  'default-secret',
  'dev-secret-change-in-production',
  'replace-me',
  'your-secret-key',
  'your-session-secret',
]);

export function isKnownInsecureSecret(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized ? KNOWN_INSECURE_SECRETS.has(normalized) : false;
}

export function assertNoKnownInsecureSecretInProduction(name: string, value: string | null | undefined): void {
  if (process.env.NODE_ENV !== 'production' || !isKnownInsecureSecret(value)) {
    return;
  }

  throw new Error(`${name} is set to a known insecure placeholder and cannot be used in production`);
}
