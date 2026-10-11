// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * /.well-known/security.txt (RFC 9116), from the operator configuration: the security contact
 * (LEGAL_SECURITY_EMAIL, else LEGAL_SUPPORT_EMAIL), the disclosure policy (the Privacy Policy's
 * security section) and an expiry 180 days ahead, recomputed on every request so it never goes
 * stale. With no contact configured there is nothing true to say: 404, and the Privacy Policy
 * leaves out its sentence about the file.
 */
import type { Request, RequestHandler } from 'express';
import { readOperatorConfig } from '../services/legal/operatorConfig.js';

const EXPIRES_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

function contactUri(value: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `mailto:${value}`;
}

/** The file's text, or null without a contact. `origin` is the site's own (https://example.org). */
export function securityTxt(env: NodeJS.ProcessEnv, origin: string | null, now: Date): string | null {
  const config = readOperatorConfig(env);
  const contact = config.security_email || config.support_email;
  if (!contact) return null;
  // Whole days, so the file is the same all day (caches) and still a full 180 days ahead.
  const expires = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + EXPIRES_DAYS * DAY_MS);
  const lines = [`Contact: ${contactUri(contact)}`, `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, 'Z')}`];
  if (origin) {
    lines.push(`Policy: ${origin}/privacy#security`);
    lines.push(`Canonical: ${origin}/.well-known/security.txt`);
  }
  lines.push('Preferred-Languages: en');
  return `${lines.join('\n')}\n`;
}

/** https://<host>, from LEGAL_SERVICE_DOMAIN or FRONTEND_URL, else the request's own host. */
function originOf(req: Request, env: NodeJS.ProcessEnv): string | null {
  const domain = readOperatorConfig(env).service_domain;
  if (domain) return `https://${domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  const host = req.get('host');
  return host ? `${req.protocol}://${host}` : null;
}

export function securityTxtHandler(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  return (req, res) => {
    const text = securityTxt(env, originOf(req, env), new Date());
    if (!text) {
      res.status(404).type('text/plain').send('Not found\n');
      return;
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain; charset=utf-8').send(text);
  };
}
