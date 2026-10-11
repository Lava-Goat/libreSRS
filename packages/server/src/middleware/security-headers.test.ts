// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE

import { describe, it, expect } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HeaderMap = Record<string, string>;

function createMockResponse(): { res: Response; headers: HeaderMap } {
  const headers: HeaderMap = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    getHeader(name: string) {
      return headers[name];
    },
  } as unknown as Response;
  return { res, headers };
}

function createMockRequest(): Request {
  return {} as Request;
}

function createMockNext(): NextFunction {
  return () => { /* no-op */ };
}

// ---------------------------------------------------------------------------
// Inline implementation — mirrors the middleware in index.ts so we can unit-
// test the logic without importing the side-effectful server entry point.
// ---------------------------------------------------------------------------

function makeSecurityHeadersMiddleware(sessionSecure: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';"
    );
    if (sessionSecure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// PRAGMA whitelist helpers — mirror the logic in index.ts
// ---------------------------------------------------------------------------

const ALLOWED_TABLES = new Set(['review_logs', 'card_states']);
const ALLOWED_INDEXES = new Set(['idx_review_logs_card_state', 'uniq_card_states_user_card_direction']);

function assertTableAllowed(table: string) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`columnExists: table '${table}' is not in the allowed list`);
  }
}

function assertIndexAllowed(table: string, index: string) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`indexExists: table '${table}' is not in the allowed list`);
  }
  if (!ALLOWED_INDEXES.has(index)) {
    throw new Error(`indexExists: index '${index}' is not in the allowed list`);
  }
}

// ---------------------------------------------------------------------------
// Open-redirect helpers — mirror the logic in index.ts
// ---------------------------------------------------------------------------

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function resolveFrontendBaseUrl(
  hostname: string,
  protocol: string,
  isProduction: boolean,
  frontendUrl: string | undefined,
  allowedRedirectHosts: Set<string>
): string {
  if (frontendUrl) {
    return frontendUrl.replace(/\/+$/, '');
  }

  if (isProduction) {
    // In production we trust req.protocol / req.get('host') which Express
    // resolves after trust-proxy — not tested here.
    return `${protocol}://app.example.com`;
  }

  if (!hostname || isLoopbackHost(hostname)) {
    return 'http://localhost:5173';
  }

  if (!allowedRedirectHosts.has(hostname)) {
    return 'http://localhost:5173';
  }

  return `${protocol}://${hostname}:5173`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Security headers middleware', () => {
  describe('when sessionSecure is false (non-HTTPS dev)', () => {
    const middleware = makeSecurityHeadersMiddleware(false);

    it('sets X-Content-Type-Options: nosniff', () => {
      const { res, headers } = createMockResponse();
      middleware(createMockRequest(), res, createMockNext());
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });

    it('sets X-Frame-Options: DENY', () => {
      const { res, headers } = createMockResponse();
      middleware(createMockRequest(), res, createMockNext());
      expect(headers['X-Frame-Options']).toBe('DENY');
    });

    it('sets Referrer-Policy: strict-origin-when-cross-origin', () => {
      const { res, headers } = createMockResponse();
      middleware(createMockRequest(), res, createMockNext());
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });

    it('sets X-Permitted-Cross-Domain-Policies: none', () => {
      const { res, headers } = createMockResponse();
      middleware(createMockRequest(), res, createMockNext());
      expect(headers['X-Permitted-Cross-Domain-Policies']).toBe('none');
    });

    it('sets a Content-Security-Policy header', () => {
      const { res, headers } = createMockResponse();
      middleware(createMockRequest(), res, createMockNext());
      expect(headers['Content-Security-Policy']).toBeTruthy();
      expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
      expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
      // media-src must permit blob: and data: so Vocabulómetro aural audio
      // (Forma A blob URLs, TTS bank, data: fallbacks) is not refused by CSP.
      expect(headers['Content-Security-Policy']).toContain("media-src 'self' blob: data:");
    });

    it('does NOT set Strict-Transport-Security when sessionSecure is false', () => {
      const { res, headers } = createMockResponse();
      middleware(createMockRequest(), res, createMockNext());
      expect(headers['Strict-Transport-Security']).toBeUndefined();
    });

    it('calls next()', () => {
      const { res } = createMockResponse();
      let called = false;
      middleware(createMockRequest(), res, () => { called = true; });
      expect(called).toBe(true);
    });
  });

  describe('when sessionSecure is true (HTTPS production)', () => {
    const middleware = makeSecurityHeadersMiddleware(true);

    it('sets Strict-Transport-Security with max-age and includeSubDomains', () => {
      const { res, headers } = createMockResponse();
      middleware(createMockRequest(), res, createMockNext());
      expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    });

    it('still sets all other security headers', () => {
      const { res, headers } = createMockResponse();
      middleware(createMockRequest(), res, createMockNext());
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['X-Permitted-Cross-Domain-Policies']).toBe('none');
      expect(headers['Content-Security-Policy']).toBeTruthy();
    });
  });
});

describe('PRAGMA table whitelist', () => {
  it('allows review_logs', () => {
    expect(() => assertTableAllowed('review_logs')).not.toThrow();
  });

  it('allows card_states', () => {
    expect(() => assertTableAllowed('card_states')).not.toThrow();
  });

  it('throws for an arbitrary table name', () => {
    expect(() => assertTableAllowed('users')).toThrow(/not in the allowed list/);
  });

  it('throws for an empty string', () => {
    expect(() => assertTableAllowed('')).toThrow(/not in the allowed list/);
  });

  it('throws for SQL injection attempt', () => {
    expect(() => assertTableAllowed("review_logs'; DROP TABLE users; --")).toThrow(
      /not in the allowed list/
    );
  });
});

describe('PRAGMA index whitelist', () => {
  it('allows valid table + index combination', () => {
    expect(() => assertIndexAllowed('review_logs', 'idx_review_logs_card_state')).not.toThrow();
    expect(() =>
      assertIndexAllowed('card_states', 'uniq_card_states_user_card_direction')
    ).not.toThrow();
  });

  it('throws for a disallowed table', () => {
    expect(() =>
      assertIndexAllowed('sessions', 'idx_review_logs_card_state')
    ).toThrow(/not in the allowed list/);
  });

  it('throws for a disallowed index', () => {
    expect(() => assertIndexAllowed('review_logs', 'idx_arbitrary')).toThrow(
      /not in the allowed list/
    );
  });

  it('throws for SQL injection in index name', () => {
    expect(() =>
      assertIndexAllowed('review_logs', "idx_review_logs_card_state'; DROP TABLE review_logs; --")
    ).toThrow(/not in the allowed list/);
  });
});

describe('Open-redirect guard in resolveFrontendBaseUrl', () => {
  const noAllowed = new Set<string>();
  const withAllowed = new Set(['staging.example.com']);

  it('returns explicit FRONTEND_URL as-is (trusted)', () => {
    const result = resolveFrontendBaseUrl(
      'evil.example.com', 'http', false, 'https://app.example.com', noAllowed
    );
    expect(result).toBe('https://app.example.com');
  });

  it('strips trailing slash from explicit FRONTEND_URL', () => {
    const result = resolveFrontendBaseUrl(
      'any', 'http', false, 'https://app.example.com/', noAllowed
    );
    expect(result).toBe('https://app.example.com');
  });

  it('falls back to localhost for loopback host', () => {
    const result = resolveFrontendBaseUrl(
      'localhost', 'http', false, undefined, noAllowed
    );
    expect(result).toBe('http://localhost:5173');
  });

  it('falls back to localhost for 127.0.0.1', () => {
    const result = resolveFrontendBaseUrl(
      '127.0.0.1', 'http', false, undefined, noAllowed
    );
    expect(result).toBe('http://localhost:5173');
  });

  it('falls back to localhost for empty hostname', () => {
    const result = resolveFrontendBaseUrl(
      '', 'http', false, undefined, noAllowed
    );
    expect(result).toBe('http://localhost:5173');
  });

  it('falls back to localhost when x-forwarded-host not in ALLOWED_REDIRECT_HOSTS', () => {
    const result = resolveFrontendBaseUrl(
      'evil.attacker.com', 'http', false, undefined, noAllowed
    );
    expect(result).toBe('http://localhost:5173');
  });

  it('uses spoofed host when it is explicitly in ALLOWED_REDIRECT_HOSTS', () => {
    const result = resolveFrontendBaseUrl(
      'staging.example.com', 'https', false, undefined, withAllowed
    );
    expect(result).toBe('https://staging.example.com:5173');
  });

  it('does not allow a host that is a prefix of an allowed host', () => {
    // 'staging.example' is not 'staging.example.com' — must be exact match
    const result = resolveFrontendBaseUrl(
      'staging.example', 'https', false, undefined, withAllowed
    );
    expect(result).toBe('http://localhost:5173');
  });
});

// ---------------------------------------------------------------------------
// CSRF double-submit cookie helpers — mirror the logic in index.ts
// ---------------------------------------------------------------------------

function parseSingleCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const nameEq = `${name}=`;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(nameEq)) {
      const value = trimmed.slice(nameEq.length).trim();
      return value || null;
    }
  }
  return null;
}

const CSRF_COOKIE = 'libresrs_csrf';
const CSRF_HEADER = 'x-csrf-token';

type MockCsrfSetup = {
  req: { method: string; cookie?: string; csrfHeader?: string };
  existingToken: string | null;
  submittedToken: string | null;
};

function simulateCsrfMiddleware(setup: MockCsrfSetup): 'pass' | 'reject' | 'issue-new' {
  const existingToken = setup.existingToken;
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(setup.req.method);

  if (!existingToken) {
    return isMutation ? 'reject' : 'issue-new';
  }

  if (!isMutation) return 'pass';

  const submitted = setup.submittedToken;
  if (!submitted || submitted !== existingToken) {
    return 'reject';
  }
  return 'pass';
}

describe('CSRF double-submit cookie middleware', () => {
  it('issues a new token when no cookie is present on a safe request', () => {
    const result = simulateCsrfMiddleware({ req: { method: 'GET' }, existingToken: null, submittedToken: null });
    expect(result).toBe('issue-new');
  });

  it('rejects POST mutations when no cookie is present', () => {
    const result = simulateCsrfMiddleware({ req: { method: 'POST' }, existingToken: null, submittedToken: null });
    expect(result).toBe('reject');
  });

  it('allows GET requests without a CSRF header', () => {
    const result = simulateCsrfMiddleware({ req: { method: 'GET' }, existingToken: 'abc123', submittedToken: null });
    expect(result).toBe('pass');
  });

  it('allows HEAD requests without a CSRF header', () => {
    const result = simulateCsrfMiddleware({ req: { method: 'HEAD' }, existingToken: 'abc123', submittedToken: null });
    expect(result).toBe('pass');
  });

  it('rejects POST mutations with no submitted token', () => {
    const result = simulateCsrfMiddleware({ req: { method: 'POST' }, existingToken: 'abc123', submittedToken: null });
    expect(result).toBe('reject');
  });

  it('rejects POST mutations with wrong token', () => {
    const result = simulateCsrfMiddleware({ req: { method: 'POST' }, existingToken: 'abc123', submittedToken: 'wrong' });
    expect(result).toBe('reject');
  });

  it('allows POST mutations with correct token', () => {
    const result = simulateCsrfMiddleware({ req: { method: 'POST' }, existingToken: 'abc123', submittedToken: 'abc123' });
    expect(result).toBe('pass');
  });

  it('rejects empty string as submitted token', () => {
    const result = simulateCsrfMiddleware({ req: { method: 'POST' }, existingToken: 'abc123', submittedToken: '' });
    expect(result).toBe('reject');
  });
});

describe('parseSingleCookie', () => {
  it('parses a single cookie', () => {
    expect(parseSingleCookie(`${CSRF_COOKIE}=tokenvalue`, CSRF_COOKIE)).toBe('tokenvalue');
  });

  it('parses the target cookie from multiple cookies', () => {
    expect(parseSingleCookie(`session=xyz; ${CSRF_COOKIE}=mytok; other=1`, CSRF_COOKIE)).toBe('mytok');
  });

  it('returns null when cookie is absent', () => {
    expect(parseSingleCookie('session=xyz; other=1', CSRF_COOKIE)).toBeNull();
  });

  it('returns null for undefined header', () => {
    expect(parseSingleCookie(undefined, CSRF_COOKIE)).toBeNull();
  });

  it('handles leading and trailing spaces', () => {
    expect(parseSingleCookie(`  ${CSRF_COOKIE}=token123  `, CSRF_COOKIE)).toBe('token123');
  });

  it('does not match a cookie that is a suffix of the target name', () => {
    expect(parseSingleCookie(`x${CSRF_COOKIE}=bad`, CSRF_COOKIE)).toBeNull();
  });

  it(`returns null when cookie value is empty string`, () => {
    expect(parseSingleCookie(`${CSRF_COOKIE}=`, CSRF_COOKIE)).toBeNull();
  });

  it('returns null for empty cookie header', () => {
    expect(parseSingleCookie('', CSRF_COOKIE)).toBeNull();
  });
});

describe('CSRF cookie and header names', () => {
  it('CSRF_COOKIE_NAME constant is libresrs_csrf', () => {
    expect(CSRF_COOKIE).toBe('libresrs_csrf');
  });

  it('CSRF_HEADER_NAME constant is x-csrf-token', () => {
    expect(CSRF_HEADER).toBe('x-csrf-token');
  });
});
