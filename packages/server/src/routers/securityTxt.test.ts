// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { securityTxt, securityTxtHandler } from './securityTxt.js';

const now = new Date('2026-10-10T21:00:00Z');

describe('securityTxt', () => {
  it('names the security contact, a policy, a canonical address and an expiry 180 days ahead', () => {
    expect(securityTxt({ LEGAL_SECURITY_EMAIL: 'security@example.org', LEGAL_SUPPORT_EMAIL: 'help@example.org' }, 'https://learn.example.org', now)).toBe([
      'Contact: mailto:security@example.org',
      'Expires: 2027-04-08T00:00:00Z',
      'Policy: https://learn.example.org/privacy#security',
      'Canonical: https://learn.example.org/.well-known/security.txt',
      'Preferred-Languages: en',
      '',
    ].join('\n'));
  });

  it('falls back to the support address, keeps a URI contact as it is, and has nothing to say without one', () => {
    expect(securityTxt({ LEGAL_SUPPORT_EMAIL: 'help@example.org' }, null, now)).toMatch(/^Contact: mailto:help@example\.org\n/);
    expect(securityTxt({ LEGAL_SECURITY_EMAIL: 'https://example.org/report' }, null, now)).toMatch(/^Contact: https:\/\/example\.org\/report\n/);
    expect(securityTxt({}, 'https://x.example', now)).toBeNull();
  });

  it('is served as text, from the configured domain, and 404 without a contact', async () => {
    const serve = async (env: NodeJS.ProcessEnv) => {
      const app = express();
      app.get('/.well-known/security.txt', securityTxtHandler(env));
      const server = app.listen(0);
      try {
        const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/security.txt`);
        return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
      } finally {
        server.close();
      }
    };
    const ok = await serve({ LEGAL_SECURITY_EMAIL: 'security@example.org', LEGAL_SERVICE_DOMAIN: 'learn.example.org' });
    expect(ok.status).toBe(200);
    expect(ok.type).toMatch(/^text\/plain/);
    expect(ok.body).toContain('Canonical: https://learn.example.org/.well-known/security.txt');
    const fromHost = await serve({ LEGAL_SECURITY_EMAIL: 'security@example.org' });
    expect(fromHost.body).toMatch(/Policy: http:\/\/127\.0\.0\.1:\d+\/privacy#security/);
    expect((await serve({})).status).toBe(404);
  });
});
