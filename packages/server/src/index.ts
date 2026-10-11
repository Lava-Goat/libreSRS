// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { createHash, randomBytes, randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import rateLimit from 'express-rate-limit';
import passport from 'passport';
import {
  Strategy as GoogleStrategy,
  type GoogleCallbackParameters,
  type Profile as GoogleProfile,
  type VerifyCallback as GoogleVerifyCallback,
} from 'passport-google-oauth20';
import * as trpcExpress from '@trpc/server/adapters/express';
import { createClient as createRedisClient } from 'redis';
import { db, schema, sqlite } from './db/index.js';
import { runMigrations } from './db/runMigrations.js';
import { buildAppRouter, createContext } from './routers/index.js';
import {
  MEDIA_BYTES,
  RECORDING_BYTES,
  acceptAudioUpload,
  handleMediaUpload,
  handleRecording,
  handleSpeakingSubmission,
} from './routers/audioUploads.js';
import { eq, sql } from 'drizzle-orm';
import { getSerializedUserId, serializeUser, type AuthenticatedUser } from './middleware/auth.js';
import { checkEmailAllowed, getNewUserRole } from './services/authAccess.js';
import { getOrCreateUserSettings } from './services/userSettings.js';
import { logger } from './logger.js';
import { isCleverAuthDisabled, isGoogleOAuthConfigured, registerGoogleStrategy, setStrategyRegistrar } from './services/setupState.js';
import { getBuildInfo } from './buildInfo.js';
import { ensureAllGroup, addUserToAllGroup } from './services/allGroup.js';
import { getAppSettings, loadAppSettingsIntoProcessEnv } from './services/appSettings.js';
import { getAssetsDir } from './services/ai/assetStorage.js';
import { userscriptsRouter } from './services/userscripts.js';
import { removeRetiredLabRecordings } from './services/recordings.js';
import { warmConjugationEngine } from './services/conjugationQuiz.js';
import { loginErrorPath, safeReturnTo } from './services/returnTo.js';
import { assertNoKnownInsecureSecretInProduction } from './utils/secrets.js';
import { googleOAuthEndpointOptions } from './services/oauthEndpoints.js';
import { pinLoginBodyParser, pinLoginRouter } from './routers/pinLogin.js';
import { googleSignInHealth, googleSignInHealthKey, callbackStateMatches, warnIfNoSchoolNetwork } from './services/googleSignInHealth.js';
import { loadGoogleProfile } from './services/googleProfile.js';
import { loadExtensions } from './extensions/load.js';
import { ext } from './extensions/registry.js';
import { startTimers } from './extensions/timers.js';
import { hashForLog, urlForLog } from './utils/logRedaction.js';
import { securityTxtHandler } from './routers/securityTxt.js';

// Before anything reads ext() (the routes below): this build's extensions, or none. Top-level
// await here only: nothing this module imports imports it back (extensions/README.md).
await loadExtensions();

const app = express();
const PORT = process.env.PORT || 6767;
const isProduction = process.env.NODE_ENV === 'production';
const sessionSameSite = process.env.SESSION_COOKIE_SAMESITE === 'none' ? 'none' : 'lax';
const sessionSecure = process.env.SESSION_COOKIE_SECURE === 'false'
  ? false
  : (isProduction || sessionSameSite === 'none');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const requireRedis = isProduction || process.env.REQUIRE_REDIS === 'true';
const buildInfo = getBuildInfo();

const redisClient = requireRedis ? createRedisClient({ url: redisUrl }) : null;
if (redisClient) {
  redisClient.on('error', (err) => {
    logger.error({ err }, 'Redis client error');
  });
}

const redisStore = redisClient
  ? new RedisStore({
    client: redisClient,
    prefix: 'libresrs:sess:',
  })
  : undefined;

function resolveTrustProxySetting(value: string | undefined, productionDefault: boolean) {
  if (value === undefined) {
    return productionDefault ? 1 : false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return 1;
  }
  if (normalized === 'false') {
    return false;
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  return value;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function getFirstHeaderValue(value: string | undefined): string {
  return value?.split(',')[0]?.trim() ?? '';
}

function readHeaderNumber(value: string | number | string[] | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (Array.isArray(value)) {
    const firstValue = value[0];
    if (typeof firstValue !== 'string') {
      return null;
    }
    const parsed = Number(firstValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getCurrentUserId(req: express.Request): number | null {
  const user = req.user as AuthenticatedUser | undefined;
  return user?.id ?? null;
}

function getHostnameFromHostHeader(hostHeader: string): string {
  const normalizedHost = hostHeader.trim();
  if (!normalizedHost) {
    return '';
  }

  if (normalizedHost.startsWith('[')) {
    const closingBracketIndex = normalizedHost.indexOf(']');
    if (closingBracketIndex > 1) {
      return normalizedHost.slice(1, closingBracketIndex);
    }
  }

  return normalizedHost.replace(/:\d+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

const ALLOWED_REDIRECT_HOSTS: Set<string> = process.env.ALLOWED_REDIRECT_HOSTS
  ? new Set(process.env.ALLOWED_REDIRECT_HOSTS.split(',').map((h) => h.trim()).filter(Boolean))
  : new Set();

function resolveFrontendBaseUrl(req: express.Request): string {
  const explicitFrontendUrl = process.env.FRONTEND_URL?.trim();
  if (explicitFrontendUrl) {
    return trimTrailingSlashes(explicitFrontendUrl);
  }

  if (isProduction) {
    return `${req.protocol}://${req.get('host')}`;
  }

  const forwardedProto = getFirstHeaderValue(req.get('x-forwarded-proto'));
  const protocol = forwardedProto || req.protocol || 'http';
  const forwardedHost = getFirstHeaderValue(req.get('x-forwarded-host'));
  const hostHeader = forwardedHost || req.get('host') || '';
  const hostname = getHostnameFromHostHeader(hostHeader);

  if (!hostname || isLoopbackHost(hostname)) {
    return 'http://localhost:5173';
  }

  // Guard against open-redirect via spoofed x-forwarded-host in non-production
  // without an explicit FRONTEND_URL: only allow hosts that are explicitly
  // listed in ALLOWED_REDIRECT_HOSTS.
  if (!ALLOWED_REDIRECT_HOSTS.has(hostname)) {
    return 'http://localhost:5173';
  }

  const frontendPort = process.env.FRONTEND_PORT?.trim() || '5173';
  return `${protocol}://${hostname}:${frontendPort}`;
}

function resolveExternalBaseUrl(req: express.Request): string {
  const forwardedProto = getFirstHeaderValue(req.get('x-forwarded-proto'));
  const protocol = forwardedProto || req.protocol || 'https';
  const forwardedHost = getFirstHeaderValue(req.get('x-forwarded-host'));
  const host = forwardedHost || req.get('host') || '';
  return `${protocol}://${host}`;
}

function resolveCleverRedirectUri(req: express.Request): string {
  const explicit = process.env.CLEVER_REDIRECT_URI?.trim();
  if (explicit) {
    return trimTrailingSlashes(explicit);
  }
  return `${resolveExternalBaseUrl(req)}/auth/clever/callback`;
}

function resolveCleverRosterRedirectUri(req: express.Request): string {
  const explicit = process.env.CLEVER_ROSTER_REDIRECT_URI?.trim();
  if (explicit) {
    return trimTrailingSlashes(explicit);
  }
  return `${resolveExternalBaseUrl(req)}/auth/clever/roster/callback`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: Record<string, unknown> | null, key: string): string | null {
  if (!value) {
    return null;
  }
  const candidate = value[key];
  if (typeof candidate !== 'string') {
    return null;
  }
  const trimmed = candidate.trim();
  return trimmed || null;
}

type OAuthUserIdentity = {
  externalId: string;
  email: string;
  name: string;
  picture: string | null;
};

async function determineNewUserRole(email: string): Promise<'admin' | 'user'> {
  const role = getNewUserRole(email);
  if (role === 'admin') return 'admin';

  if (!process.env.ADMIN_EMAIL?.trim()) {
    const userCount = await db.select({ count: sql<number>`count(*)` }).from(schema.users);
    if (userCount[0]?.count === 0) return 'admin';
  }

  return 'user';
}

async function getOrCreateUserForOAuth(identity: OAuthUserIdentity): Promise<AuthenticatedUser> {
  const normalizedEmail = identity.email.trim().toLowerCase();

  let user = await db.query.users.findFirst({
    where: eq(schema.users.googleId, identity.externalId),
  });

  if (!user) {
    user = await db.query.users.findFirst({
      where: eq(schema.users.email, normalizedEmail),
    });
  }

  if (!user) {
    const inserted = await db.insert(schema.users).values({
      googleId: identity.externalId,
      email: normalizedEmail,
      name: identity.name || normalizedEmail,
      picture: identity.picture,
      role: await determineNewUserRole(normalizedEmail),
    }).returning();

    user = inserted[0];
    await addUserToAllGroup(user.id);
  } else {
    const updates: {
      googleId?: string;
      name?: string;
      picture?: string | null;
    } = {};

    if (user.googleId.startsWith('pending:')) {
      updates.googleId = identity.externalId;
    }

    if (identity.name && user.name !== identity.name) {
      updates.name = identity.name;
    }

    if ((identity.picture ?? null) !== (user.picture ?? null)) {
      updates.picture = identity.picture;
    }

    if (Object.keys(updates).length > 0) {
      const updated = await db.update(schema.users)
        .set(updates)
        .where(eq(schema.users.id, user.id))
        .returning();
      user = updated[0] ?? user;
    }
  }

  await getOrCreateUserSettings(user.id);
  return serializeUser(user);
}

async function fetchCleverJson(url: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Clever API request failed: ${response.status}`);
  }

  const payload = await response.json();
  const record = toRecord(payload);
  if (!record) {
    throw new Error('Clever API response was not an object');
  }
  return record;
}

async function fetchCleverIdentity(accessToken: string): Promise<OAuthUserIdentity> {
  const userInfo = await fetchCleverJson('https://api.clever.com/userinfo', accessToken);
  const sub = readString(userInfo, 'sub');
  const userInfoEmail = readString(userInfo, 'email');

  const userInfoName = readString(userInfo, 'name')
    ?? [readString(userInfo, 'given_name'), readString(userInfo, 'family_name')]
      .filter(Boolean)
      .join(' ')
      .trim();

  const userInfoPicture = readString(userInfo, 'picture');
  if (sub && userInfoEmail) {
    return {
      externalId: `clever:${sub}`,
      email: userInfoEmail.toLowerCase(),
      name: userInfoName || userInfoEmail,
      picture: userInfoPicture,
    };
  }

  const me = await fetchCleverJson('https://api.clever.com/v3.0/me', accessToken);
  const meData = toRecord(me.data);
  const meLinks = toRecord(me.links);
  const meId = readString(meData, 'id');

  let userUrl = readString(meLinks, 'self');
  if (!userUrl && meId) {
    userUrl = `https://api.clever.com/v3.0/users/${meId}`;
  }

  if (!userUrl) {
    throw new Error('Unable to resolve Clever user profile URL');
  }

  if (userUrl.startsWith('/')) {
    userUrl = `https://api.clever.com${userUrl}`;
  }

  const userPayload = await fetchCleverJson(userUrl, accessToken);
  const userData = toRecord(userPayload.data);

  const cleverId = readString(userData, 'id') ?? meId;
  const cleverEmail = readString(userData, 'email');
  const cleverFirst = readString(toRecord(userData?.name), 'first');
  const cleverLast = readString(toRecord(userData?.name), 'last');
  const cleverName = [cleverFirst, cleverLast].filter(Boolean).join(' ').trim() || cleverEmail || null;

  if (!cleverId || !cleverEmail) {
    throw new Error('Clever profile did not include required id/email');
  }

  return {
    externalId: `clever:${cleverId}`,
    email: cleverEmail.toLowerCase(),
    name: cleverName || cleverEmail,
    picture: null,
  };
}

const trustProxySetting = resolveTrustProxySetting(process.env.TRUST_PROXY, isProduction);
app.set('trust proxy', trustProxySetting);
logger.info({ trustProxy: app.get('trust proxy') }, 'Trust proxy configured');

app.use((req, res, next) => {
  const requestId = getFirstHeaderValue(req.get('x-request-id')) || randomUUID();
  const requestStartedAt = process.hrtime.bigint();
  const requestLogger = logger.child({
    requestId,
    method: req.method,
    path: req.path,
  });

  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  // No referer, and urlForLog's URL: what the request log keeps (doc/legal-documents.md, "Logs").
  const loggedUrl = urlForLog(req.originalUrl);
  requestLogger.info({
    event: 'http.request.start',
    url: loggedUrl,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? null,
    userId: getCurrentUserId(req),
    requestBytes: readHeaderNumber(req.headers['content-length']),
  }, 'HTTP request started');

  let completed = false;

  res.on('finish', () => {
    completed = true;
    const durationMs = Number(process.hrtime.bigint() - requestStartedAt) / 1_000_000;
    const responsePayload = {
      event: 'http.request.finish',
      url: loggedUrl,
      statusCode: res.statusCode,
      durationMs,
      userId: getCurrentUserId(req),
      responseBytes: readHeaderNumber(res.getHeader('content-length')),
    };

    if (res.statusCode >= 500) {
      requestLogger.error(responsePayload, 'HTTP request completed with server error');
      return;
    }

    if (res.statusCode >= 400) {
      requestLogger.warn(responsePayload, 'HTTP request completed with client error');
      return;
    }

    requestLogger.info(responsePayload, 'HTTP request completed');
  });

  res.on('close', () => {
    if (completed) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - requestStartedAt) / 1_000_000;
    requestLogger.warn({
      event: 'http.request.close',
      url: loggedUrl,
      statusCode: res.statusCode,
      durationMs,
      userId: getCurrentUserId(req),
    }, 'HTTP request closed before completion');
  });

  next();
});

app.use(cors({
  origin: isProduction
    ? false
    : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));

// Security headers middleware — applied early, before rate limiters and routes.
app.use((_req, res, next) => {
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
});

// "Sign in with a PIN" takes a 2 KB JSON body; parsed here first, so the 10 MB parser below skips it.
app.use('/auth/pin', pinLoginBodyParser);
app.use(express.json({ limit: '10mb' }));

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    ...buildInfo,
  });
});

// RFC 9116, from the operator's legal configuration (404 until a contact is set).
app.get('/.well-known/security.txt', securityTxtHandler());

app.get('/api/build-info', (_req, res) => {
  res.status(200).json(buildInfo);
});

// These limiters key by client IP — and an entire school arrives from ONE NAT
// IP. Ceilings must fit a whole class at the bell, not a single browser:
// 60/15min on /auth locked students out of login ("wait and retry"), and
// 600/min on /api/trpc bounced review submissions mid-study. Auth is OAuth
// redirects only (no password brute-force surface), so these stay useful as
// DoS guards at class scale.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for the one-time setup endpoint (unauthenticated, public)
const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/auth', authLimiter);
app.use('/api/trpc/setup.saveCredentials', setupLimiter);
app.use('/api/trpc', apiLimiter);
// Token-authenticated extension APIs: before the session, so no cookie counts there.
for (const mount of ext().beforeSession) app.use(mount.path, mount.router());

// Audio/image assets are static, immutable, unguessable-UUID files fetched
// dozens of times per study session. Mounted BEFORE the session middleware so
// each request skips the valkey session lookup + passport deserialization —
// meaningful at class scale (30 students × dozens of clips).
app.use('/api/assets', express.static(getAssetsDir(), {
  maxAge: '1y',
  immutable: true,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));

const DEFAULT_SESSION_SECRET = 'dev-secret-change-in-production';
const SESSION_SECRET = process.env.SESSION_SECRET?.trim() || DEFAULT_SESSION_SECRET;
assertNoKnownInsecureSecretInProduction('SESSION_SECRET', SESSION_SECRET);

app.use(session({
  ...(redisStore ? { store: redisStore } : {}),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: sessionSecure,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: sessionSameSite,
  },
}));

app.use(passport.initialize());
app.use(passport.session());
// Sign in with a PIN (v1.22.0; routers/pinLogin.ts). A mutation: it echoes the CSRF cookie like tRPC.
app.use('/auth/pin', csrfProtectionMiddleware);
app.use(pinLoginRouter());

passport.serializeUser((user: AuthenticatedUser, done) => {
  done(null, String(user.id));
});

passport.deserializeUser((serialized: unknown, done) => {
  try {
    const userId = getSerializedUserId(serialized);
    if (userId === null) {
      return done(null, false);
    }

    db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    }).then((user) => {
      if (!user) return done(null, false);
      return done(null, serializeUser(user));
    }).catch((error) => {
      logger.error({ err: error }, 'Failed to deserialize user');
      return done(error as Error);
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to deserialize user');
    return done(error as Error);
  }
});


const googleClassroomScopes = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
];

// Empty (Google's own endpoints) except in the full-stack e2e tests: honoured only with NODE_ENV=test.
const googleOAuthEndpoints = googleOAuthEndpointOptions();

function registerGoogleOAuthStrategy(clientId: string, clientSecret: string): boolean {

  try {
    passport.unuse('google');
  } catch { /* strategy may not exist yet */ }
  try {
    passport.unuse('google-classroom');
  } catch { /* strategy may not exist yet */ }

  const googleStrategy: GoogleStrategy = new GoogleStrategy({
    ...googleOAuthEndpoints,
    clientID: clientId,
    clientSecret: clientSecret,
    callbackURL: '/auth/google/callback',
    proxy: true,
    // OAuth state in the session: without it a forged callback link could sign a student in as someone else.
    state: true,
    // The profile is loaded below, where a refused userinfo call can be retried (services/googleProfile.ts).
    skipUserProfile: true,
  }, async (accessToken: string, _refreshToken: string, params: GoogleCallbackParameters, _profile: GoogleProfile, done: GoogleVerifyCallback) => {
    try {
      const fetchProfile = (token: string) => new Promise<GoogleProfile>((resolveProfile, rejectProfile) => {
        googleStrategy.userProfile(token, (err, loaded) => (err ? rejectProfile(err) : resolveProfile(loaded as GoogleProfile)));
      });
      const { profile, source, firstError } = await loadGoogleProfile(fetchProfile, accessToken, params.id_token, clientId);
      if (source !== 'userinfo') {
        logger.warn({ source, err: firstError?.message }, 'Google userinfo refused a sign-in; profile loaded another way');
      }

      const email = profile.emails?.[0]?.value?.trim().toLowerCase();
      if (!email) {
        return done(new Error('No email found in Google profile'));
      }

      const emailAccess = await checkEmailAllowed(email);
      if (!emailAccess.allowed) {
        if (emailAccess.reason === 'initial_admin_not_configured') {
          return done(
            new Error(
              'Initial admin email is not configured. Set ADMIN_EMAIL before first sign-in.'
            )
          );
        }
        if (emailAccess.reason === 'initial_admin_required') {
          return done(
            new Error(
              'Only the configured ADMIN_EMAIL can sign in before any users exist.'
            )
          );
        }
        return done(new Error('Email not authorized. Please contact an administrator.'));
      }

      const user = await getOrCreateUserForOAuth({
        externalId: profile.id,
        email,
        name: profile.displayName || email,
        picture: profile.photos?.[0]?.value || null,
      });

      done(null, user);
    } catch (error) {
      done(error as Error);
    }
  });
  passport.use(googleStrategy);

  passport.use('google-classroom', new GoogleStrategy({
    ...googleOAuthEndpoints,
    clientID: clientId,
    clientSecret: clientSecret,
    callbackURL: '/auth/google/classroom/callback',
    proxy: true,
    passReqToCallback: true,
    state: true,
  }, async (req: express.Request, accessToken: string, refreshToken: string, profile, done) => {
    try {
      const currentUser = req.user as AuthenticatedUser | undefined;
      if (!currentUser || currentUser.role !== 'admin') {
        logger.warn('Google Classroom OAuth attempted without an admin session');
        return done(new Error('Admin access required'));
      }

      const email = profile.emails?.[0]?.value?.trim().toLowerCase();
      if (email) {
        logger.info({ emailHash: hashForLog(email) }, 'Google Classroom OAuth authorized account');
      }

      req.session.googleClassroomAccessToken = accessToken;
      if (refreshToken) {
        req.session.googleClassroomRefreshToken = refreshToken;
      }

      return done(null, currentUser);
    } catch (error) {
      return done(error as Error);
    }
  }));

  return true;
}

let registeredGoogleCredentialsFingerprint: string | null = null;

async function ensureGoogleOAuthStrategyRegistered(): Promise<boolean> {
  const settings = await getAppSettings();
  const clientId = settings.googleClientId?.trim();
  const clientSecret = settings.googleClientSecret?.trim();

  if (!clientId || !clientSecret) {
    registeredGoogleCredentialsFingerprint = null;
    return false;
  }

  const fingerprint = `${clientId}\n${clientSecret}`;
  if (registeredGoogleCredentialsFingerprint === fingerprint) {
    return true;
  }

  const registered = registerGoogleOAuthStrategy(clientId, clientSecret);
  if (registered) {
    process.env.GOOGLE_CLIENT_ID = clientId;
    process.env.GOOGLE_CLIENT_SECRET = clientSecret;
    registeredGoogleCredentialsFingerprint = fingerprint;
  }

  return registered;
}

// Store registrar so setup can register OAuth dynamically after saving credentials
setStrategyRegistrar(ensureGoogleOAuthStrategyRegistered);

/**
 * The page to come back to after signing in (?returnTo=/signups?sheet=3), kept
 * in the session across the trip to the identity provider. A sign-in without
 * one forgets any left over from a sign-in that was abandoned.
 */
function rememberReturnTo(req: express.Request): Promise<void> {
  const returnTo = safeReturnTo(req.query.returnTo);
  if (returnTo) req.session.returnTo = returnTo;
  else if (req.session.returnTo) delete req.session.returnTo;
  else return Promise.resolve();
  return new Promise((resolveSave) => {
    req.session.save((saveError) => {
      // Signing in matters more than where it lands afterwards.
      if (saveError) logger.warn({ err: saveError }, 'Could not keep the page to return to after sign-in');
      resolveSave();
    });
  });
}

// Dynamic route handlers — check isGoogleOAuthConfigured() at request time
app.get('/auth/google', async (req, res, next) => {
  try {
    if (!await registerGoogleStrategy()) {
      logger.warn({ path: req.path }, 'Google OAuth requested but not configured');
      const baseUrl = resolveFrontendBaseUrl(req);
      return res.redirect(`${baseUrl}/login?error=oauth_not_configured`);
    }
    await rememberReturnTo(req);
    // Exactly 'profile' and 'email'. Adding 'openid' (tried in v1.18.0) can send managed school
    // accounts back through a consent they cannot give, so their sign-ins stall at Google. The
    // userinfo retry in services/googleProfile.ts still applies; its ID-token fallback works only
    // if Google sends an ID token for these scopes.
    googleSignInHealth.noteStart(googleSignInHealthKey(req));
    return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize Google OAuth strategy');
    const baseUrl = resolveFrontendBaseUrl(req);
    return res.redirect(`${baseUrl}/login?error=oauth_not_configured`);
  }
});

app.get('/auth/google/classroom', async (req, res, next) => {
  try {
    if (!await registerGoogleStrategy()) {
      logger.warn({ path: req.path }, 'Google Classroom OAuth requested but not configured');
      const baseUrl = resolveFrontendBaseUrl(req);
      return res.redirect(`${baseUrl}/admin?tab=groups&classroom=oauth_not_configured`);
    }

    const currentUser = req.user as AuthenticatedUser | undefined;
    if (!currentUser || currentUser.role !== 'admin') {
      const baseUrl = resolveFrontendBaseUrl(req);
      return res.redirect(`${baseUrl}/login?error=not_authorized`);
    }

    const authOptions = {
      scope: googleClassroomScopes,
      accessType: 'offline',
      prompt: 'consent',
      includeGrantedScopes: true,
    };

    return passport.authenticate('google-classroom', authOptions)(req, res, next);
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize Google Classroom OAuth strategy');
    const baseUrl = resolveFrontendBaseUrl(req);
    return res.redirect(`${baseUrl}/admin?tab=groups&classroom=oauth_not_configured`);
  }
});

app.get('/auth/google/callback', async (req, res, next) => {
  if (!await registerGoogleStrategy()) {
    const baseUrl = resolveFrontendBaseUrl(req);
    return res.redirect(`${baseUrl}/login?error=oauth_not_configured`);
  }
  // Is Google letting students in? (services/googleSignInHealth.ts) Keyed before req.logIn regenerates the session.
  const healthKey = googleSignInHealthKey(req);
  googleSignInHealth.noteCallback(healthKey, req.query.error, callbackStateMatches(req));

  return passport.authenticate('google', (err: Error | null, user: AuthenticatedUser | false) => {
    const baseUrl = resolveFrontendBaseUrl(req);
    // Read before logging in: req.logIn starts a new session, and this goes with the old one.
    const returnTo = safeReturnTo(req.session.returnTo);

    if (err) {
      logger.warn({ err }, 'OAuth error');
      // Google's ?error=admin_policy_enforced comes with no error_description, so passport's error has no
      // message: back to the login page (and its PIN chip), not a 500.
      const errorType = typeof err.message === 'string' && err.message.includes('not authorized') ? 'not_authorized' : 'auth_failed';
      return res.redirect(`${baseUrl}${loginErrorPath(errorType, returnTo)}`);
    }

    if (!user) {
      return res.redirect(`${baseUrl}${loginErrorPath('auth_failed', returnTo)}`);
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        logger.error({ err: loginErr }, 'Login error');
        return res.redirect(`${baseUrl}${loginErrorPath('auth_failed', returnTo)}`);
      }
      googleSignInHealth.noteSignedIn(healthKey, user.role);
      return res.redirect(`${baseUrl}${returnTo ?? '/'}`);
    });
  })(req, res, next);
});

app.get('/auth/google/classroom/callback', async (req, res, next) => {
  if (!await registerGoogleStrategy()) {
    const baseUrl = resolveFrontendBaseUrl(req);
    return res.redirect(`${baseUrl}/admin?tab=groups&classroom=oauth_not_configured`);
  }

  return passport.authenticate('google-classroom', (err: Error | null, user: AuthenticatedUser | false) => {
    const baseUrl = resolveFrontendBaseUrl(req);
    const adminUrl = `${baseUrl}/admin?tab=groups`;

    if (err || !user) {
      logger.warn({ err }, 'Google Classroom OAuth error');
      return res.redirect(`${adminUrl}&classroom=auth_failed`);
    }

    return req.session.save((saveError) => {
      if (saveError) {
        logger.error({ err: saveError }, 'Failed to persist Google Classroom session tokens');
        return res.redirect(`${adminUrl}&classroom=auth_failed`);
      }
      return res.redirect(`${adminUrl}&classroom=connected`);
    });
  })(req, res, next);
});

function registerCleverRoutes() {
  const cleverClientId = process.env.CLEVER_CLIENT_ID;
  const cleverClientSecret = process.env.CLEVER_CLIENT_SECRET;
  const cleverOAuthConfigured = !isCleverAuthDisabled()
    && Boolean(cleverClientId && cleverClientSecret);

if (cleverOAuthConfigured) {
  app.get('/auth/clever', (req, res) => {
    const state = randomBytes(16).toString('hex');
    req.session.cleverOAuthState = state;
    const returnTo = safeReturnTo(req.query.returnTo);
    if (returnTo) req.session.returnTo = returnTo;
    else delete req.session.returnTo;

    const authorizeParams = new URLSearchParams({
      response_type: 'code',
      client_id: cleverClientId as string,
      redirect_uri: resolveCleverRedirectUri(req),
      state,
    });

    req.session.save((saveError) => {
      if (saveError) {
        logger.error({ err: saveError }, 'Failed to persist Clever OAuth state');
        const baseUrl = resolveFrontendBaseUrl(req);
        return res.redirect(`${baseUrl}/login?error=auth_failed`);
      }

      return res.redirect(`https://clever.com/oauth/authorize?${authorizeParams.toString()}`);
    });
  });

  app.get('/auth/clever/callback', async (req, res) => {
    const baseUrl = resolveFrontendBaseUrl(req);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const callbackError = typeof req.query.error === 'string' ? req.query.error : '';

    if (callbackError) {
      logger.warn({ callbackError }, 'Clever OAuth callback returned an error');
      return res.redirect(`${baseUrl}/login?error=auth_failed`);
    }

    if (!code || !state || !req.session.cleverOAuthState || state !== req.session.cleverOAuthState) {
      logger.warn('Invalid Clever OAuth state or missing authorization code');
      return res.redirect(`${baseUrl}/login?error=auth_failed`);
    }

    delete req.session.cleverOAuthState;

    try {
      const cleverTokenAbort = new AbortController();
      const cleverTokenTimeout = setTimeout(() => cleverTokenAbort.abort(), 10_000);
      let tokenResponse: Response;
      try {
        tokenResponse = await fetch('https://clever.com/oauth/tokens', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: cleverClientId as string,
            client_secret: cleverClientSecret as string,
            redirect_uri: resolveCleverRedirectUri(req),
          }),
          signal: cleverTokenAbort.signal,
        });
      } finally {
        clearTimeout(cleverTokenTimeout);
      }

      if (!tokenResponse.ok) {
        logger.warn({ status: tokenResponse.status }, 'Clever token exchange failed');
        return res.redirect(`${baseUrl}/login?error=auth_failed`);
      }

      const tokenPayload = toRecord(await tokenResponse.json());
      const accessToken = readString(tokenPayload, 'access_token');
      if (!accessToken) {
        logger.warn('Clever token response missing access token');
        return res.redirect(`${baseUrl}/login?error=auth_failed`);
      }

      const cleverIdentity = await fetchCleverIdentity(accessToken);
      const emailAccess = await checkEmailAllowed(cleverIdentity.email);
      if (!emailAccess.allowed) {
        if (emailAccess.reason === 'initial_admin_not_configured') {
          logger.warn('Initial admin email not configured for Clever sign-in');
        } else if (emailAccess.reason === 'initial_admin_required') {
          logger.warn('Initial admin must sign in before Clever users can be added');
        }
        return res.redirect(`${baseUrl}/login?error=not_authorized`);
      }

      const user = await getOrCreateUserForOAuth(cleverIdentity);
      // Read before logging in: req.logIn starts a new session.
      const returnTo = safeReturnTo(req.session.returnTo);
      return req.logIn(user, (loginErr) => {
        if (loginErr) {
          logger.error({ err: loginErr }, 'Clever login error');
          return res.redirect(`${baseUrl}${loginErrorPath('auth_failed', returnTo)}`);
        }
        return res.redirect(`${baseUrl}${returnTo ?? '/'}`);
      });
    } catch (error) {
      logger.error({ err: error }, 'Unhandled Clever OAuth callback error');
      return res.redirect(`${baseUrl}/login?error=auth_failed`);
    }
  });
} else {
  const cleverNotConfiguredHandler = (req: express.Request, res: express.Response) => {
    logger.warn({ path: req.path }, 'Clever OAuth requested but not configured');
    const baseUrl = resolveFrontendBaseUrl(req);
    return res.redirect(`${baseUrl}/login?error=oauth_not_configured`);
  };

  app.get('/auth/clever', cleverNotConfiguredHandler);
  app.get('/auth/clever/callback', cleverNotConfiguredHandler);
}

// Clever roster import — admin-only OAuth flow to store access token for section/student fetching
if (cleverOAuthConfigured) {
  app.get('/auth/clever/roster', (req, res) => {
    const baseUrl = resolveFrontendBaseUrl(req);
    const currentUser = req.user as { role?: string } | undefined;
    if (!currentUser || currentUser.role !== 'admin') {
      return res.redirect(`${baseUrl}/login?error=not_authorized`);
    }

    const state = randomBytes(16).toString('hex');
    req.session.cleverRosterOAuthState = state;

    const authorizeParams = new URLSearchParams({
      response_type: 'code',
      client_id: cleverClientId as string,
      redirect_uri: resolveCleverRosterRedirectUri(req),
      state,
    });

    return req.session.save((saveError) => {
      if (saveError) {
        logger.error({ event: 'clever_roster.session.save_failed', error: saveError }, 'Failed to save session before Clever roster OAuth redirect');
        return res.redirect(`${baseUrl}/admin?tab=groups&clever=auth_failed`);
      }
      return res.redirect(`https://clever.com/oauth/authorize?${authorizeParams.toString()}`);
    });
  });

  app.get('/auth/clever/roster/callback', async (req, res) => {
    const baseUrl = resolveFrontendBaseUrl(req);
    const adminUrl = `${baseUrl}/admin?tab=groups`;

    const currentUser = req.user as { role?: string } | undefined;
    if (!currentUser || currentUser.role !== 'admin') {
      return res.redirect(`${baseUrl}/login?error=not_authorized`);
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    const expectedState = req.session.cleverRosterOAuthState;

    delete req.session.cleverRosterOAuthState;

    if (!code || !stateParam || stateParam !== expectedState) {
      logger.warn({ event: 'clever_roster.callback.invalid_state' }, 'Clever roster OAuth state mismatch or missing code');
      return res.redirect(`${adminUrl}&clever=auth_failed`);
    }

    try {
      const cleverTokenAbort = new AbortController();
      const cleverTokenTimeout = setTimeout(() => cleverTokenAbort.abort(), 10_000);

      let tokenPayload: Record<string, unknown>;
      try {
        const tokenResponse = await fetch('https://clever.com/oauth/tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: cleverClientId as string,
            client_secret: cleverClientSecret as string,
            redirect_uri: resolveCleverRosterRedirectUri(req),
          }),
          signal: cleverTokenAbort.signal,
        });
        tokenPayload = toRecord(await tokenResponse.json()) ?? {};
      } finally {
        clearTimeout(cleverTokenTimeout);
      }

      const accessToken = typeof tokenPayload.access_token === 'string' ? tokenPayload.access_token.trim() : '';
      if (!accessToken) {
        logger.warn({ event: 'clever_roster.callback.no_token' }, 'Clever roster OAuth token exchange returned no access token');
        return res.redirect(`${adminUrl}&clever=auth_failed`);
      }

      req.session.cleverRosterAccessToken = accessToken;
      return req.session.save((saveError) => {
        if (saveError) {
          logger.error({ event: 'clever_roster.session.save_failed', error: saveError }, 'Failed to save Clever roster token in session');
          return res.redirect(`${adminUrl}&clever=auth_failed`);
        }
        return res.redirect(`${adminUrl}&clever=connected`);
      });
    } catch (err) {
      logger.error({ event: 'clever_roster.callback.error', error: err }, 'Clever roster OAuth callback error');
      return res.redirect(`${adminUrl}&clever=auth_failed`);
    }
  });
} else {
  const cleverRosterNotConfiguredHandler = (_req: express.Request, res: express.Response) => {
    const baseUrl = resolveFrontendBaseUrl(_req);
    return res.redirect(`${baseUrl}/admin?tab=groups&clever=oauth_not_configured`);
  };
  app.get('/auth/clever/roster', cleverRosterNotConfiguredHandler);
  app.get('/auth/clever/roster/callback', cleverRosterNotConfiguredHandler);
}
} // end registerCleverRoutes


// CSRF protection — double-submit cookie pattern.
// The server issues a non-httpOnly cookie; the client JS must read it and
// echo the value in the x-csrf-token request header on every mutation.
// See packages/client/src/api/trpc.ts for the client-side send.
const CSRF_COOKIE_NAME = 'libresrs_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

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

function csrfProtectionMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const existingToken = parseSingleCookie(req.get('cookie'), CSRF_COOKIE_NAME);
  const isMutation = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (!existingToken) {
    // Safe requests bootstrap the token. Mutations require a token that existed
    // before the request so a cross-site POST cannot mint and use one.
    res.cookie(CSRF_COOKIE_NAME, randomBytes(32).toString('hex'), {
      httpOnly: false,
      sameSite: sessionSameSite,
      secure: sessionSecure,
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    });

    if (isMutation) {
      logger.warn({
        event: 'csrf.rejected',
        path: req.path,
        method: req.method,
        hasSubmittedToken: Boolean(req.get(CSRF_HEADER_NAME)),
      }, 'CSRF token missing');
      res.status(403).json({ error: 'CSRF token required' });
      return;
    }

    next();
    return;
  }

  if (isMutation) {
    const submitted = req.get(CSRF_HEADER_NAME);
    if (!submitted || submitted !== existingToken) {
      logger.warn({
        event: 'csrf.rejected',
        path: req.path,
        method: req.method,
        hasSubmittedToken: Boolean(submitted),
      }, 'CSRF token validation failed');
      res.status(403).json({ error: 'CSRF token mismatch' });
      return;
    }
  }

  next();
}

// ---------------------------------------------------------------------------
// Audio as a raw body: course audio, speaking recordings, and playing a
// recording back privately (routers/audioUploads.ts).
// ---------------------------------------------------------------------------

/** Uploads and recording playback; lab heartbeats go through tRPC's own limiter. */
const audioLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

for (const path of ['/api/media', '/api/speaking', '/api/recordings']) {
  app.use(path, audioLimiter, csrfProtectionMiddleware);
}
app.post(
  '/api/media',
  acceptAudioUpload({ adminOnly: true, maxBytes: MEDIA_BYTES }),
  express.raw({ type: () => true, limit: MEDIA_BYTES }),
  handleMediaUpload,
);
app.post(
  '/api/speaking/:taskId/submission',
  acceptAudioUpload({ adminOnly: false, maxBytes: RECORDING_BYTES }),
  express.raw({ type: () => true, limit: RECORDING_BYTES }),
  handleSpeakingSubmission,
);
app.get('/api/recordings/:filename', handleRecording);

app.use('/api/trpc', csrfProtectionMiddleware);

const appRouter = buildAppRouter(ext().routers);
app.use('/api/trpc', trpcExpress.createExpressMiddleware({
  router: appRouter,
  createContext,
  onError: ({ path, type, error, input, ctx }) => {
    logger.error({
      event: 'trpc.request.error',
      err: error,
      requestId: ctx?.requestId ?? null,
      path: path ?? null,
      type,
      code: error.code,
      inputType: Array.isArray(input) ? 'array' : input === null ? 'null' : typeof input,
    }, 'tRPC request failed');
  },
}));

if (isProduction) {
  const publicPath = resolve(__dirname, '../public');
  const rootPath = resolve(__dirname, '../../../');
  // Userscripts: the built-in copy, or a newer one published to data/tools without a rebuild
  // (npm run userscripts:publish; services/userscripts.ts).
  app.use('/tools', userscriptsRouter(resolve(publicPath, 'tools'), process.env.USERSCRIPTS_DIR ?? resolve(process.cwd(), 'data', 'tools')));
  app.use(express.static(publicPath, {
    // Userscripts (/tools/…/*.user.js) update themselves from here: always ask again, so a new
    // @version is seen at the extension's next check, never an old copy from a cache.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.user.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  app.get('/logo.svg', (_req, res) => {
    res.sendFile('logo.svg', { root: rootPath });
  });

  app.get(/(.*)/, (_req, res) => {
    res.sendFile('index.html', { root: publicPath });
  });
}

type JournalEntry = {
  tag: string;
  when: number;
};

const MIGRATIONS_TABLE = '__drizzle_migrations';
const REVIEW_LOGS_STATE_MIGRATION = '0001_rich_stranger';
const ENABLE_LEGACY_MIGRATION_BACKFILL = process.env.ENABLE_LEGACY_MIGRATION_BACKFILL !== 'false';

const ALLOWED_TABLES = new Set(['review_logs', 'card_states']);
const ALLOWED_INDEXES = new Set(['idx_review_logs_card_state', 'uniq_card_states_user_card_direction']);

async function columnExists(table: string, column: string): Promise<boolean> {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`columnExists: table '${table}' is not in the allowed list`);
  }
  const rows = await db.values(sql.raw(`PRAGMA table_info('${table}')`));
  return rows.some((row) => row[1] === column);
}

async function indexExists(table: string, index: string): Promise<boolean> {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`indexExists: table '${table}' is not in the allowed list`);
  }
  if (!ALLOWED_INDEXES.has(index)) {
    throw new Error(`indexExists: index '${index}' is not in the allowed list`);
  }
  const rows = await db.values(sql.raw(`PRAGMA index_list('${table}')`));
  return rows.some((row) => row[1] === index);
}

async function backfillMigrationIfNeeded(migrationsFolder: string) {
  // Legacy one-time fix for deployments that applied schema changes outside the
  // Drizzle migration ledger. Can be disabled once all environments are clean.
  if (!ENABLE_LEGACY_MIGRATION_BACKFILL) {
    return;
  }

  const journalPath = resolve(migrationsFolder, 'meta/_journal.json');
  let journalEntries: JournalEntry[] = [];
  try {
    const raw = readFileSync(journalPath, 'utf8');
    const parsed = JSON.parse(raw) as { entries?: JournalEntry[] };
    journalEntries = parsed.entries ?? [];
  } catch (error) {
    logger.warn({ err: error }, 'Unable to read migration journal');
    return;
  }

  const targetEntry = journalEntries.find((entry) => entry.tag === REVIEW_LOGS_STATE_MIGRATION);
  if (!targetEntry) {
    return;
  }

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_TABLE)} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const lastRow = await db.values(
    sql`SELECT created_at FROM ${sql.identifier(MIGRATIONS_TABLE)} ORDER BY created_at DESC LIMIT 1`
  );
  const lastCreatedAt = Number(lastRow[0]?.[0] ?? 0);
  if (lastCreatedAt >= targetEntry.when) {
    return;
  }

  const [hasCardStateId, hasSnapshot, hasReviewLogIndex, hasUniqueIndex] = await Promise.all([
    columnExists('review_logs', 'card_state_id'),
    columnExists('review_logs', 'previous_state_snapshot'),
    indexExists('review_logs', 'idx_review_logs_card_state'),
    indexExists('card_states', 'uniq_card_states_user_card_direction'),
  ]);

  if (!hasCardStateId || !hasSnapshot || !hasReviewLogIndex || !hasUniqueIndex) {
    return;
  }

  const migrationSql = readFileSync(resolve(migrationsFolder, `${targetEntry.tag}.sql`), 'utf8');
  const hash = createHash('sha256').update(migrationSql).digest('hex');

  await db.run(
    sql`INSERT INTO ${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") VALUES (${hash}, ${targetEntry.when})`
  );

  logger.warn({ tag: targetEntry.tag }, 'Backfilled migration metadata for existing schema');
}

async function getMigrationCount(): Promise<number> {
  try {
    const rows = await db.values(sql`SELECT COUNT(*) FROM ${sql.identifier(MIGRATIONS_TABLE)}`);
    return Number(rows[0]?.[0] ?? 0);
  } catch {
    return 0;
  }
}

async function startServer() {
  const migrationsFolder = resolve(__dirname, '../drizzle');
  const countBefore = await getMigrationCount();
  logger.info({
    migrationsFolder,
    enableLegacyMigrationBackfill: ENABLE_LEGACY_MIGRATION_BACKFILL,
    logLevel: logger.level,
    migrationsApplied: countBefore,
  }, 'Running migrations');
  await backfillMigrationIfNeeded(migrationsFolder);
  const report = runMigrations(db, sqlite, migrationsFolder);
  const countAfter = await getMigrationCount();
  if (countAfter > countBefore) {
    logger.info({ newMigrations: countAfter - countBefore, totalMigrations: countAfter, extensions: report.extensions }, 'Applied new migrations');
  } else {
    logger.info({ totalMigrations: countAfter, extensions: report.extensions }, 'No new migrations applied');
  }
  // 0032 dropped the only pointer to v1.8.0's lab recordings; never throws.
  await removeRetiredLabRecordings();
  // Performance: enable WAL mode for concurrent reads during writes,
  // set busy timeout to retry on lock contention, reduce fsync overhead.
  await db.run(sql`PRAGMA journal_mode=WAL`);
  await db.run(sql`PRAGMA busy_timeout=5000`);
  await db.run(sql`PRAGMA synchronous=NORMAL`);

  // The conjugation engine builds its tables on first use (about a second of
  // synchronous CPU); pay it here, before the port opens, not in a student's request.
  try {
    const warm = warmConjugationEngine();
    logger.info({ ms: warm.ms, forms: warm.forms }, 'Conjugation engine warmed');
  } catch (err) {
    logger.warn({ err }, 'Conjugation engine warm-up failed; it will build on first use');
  }

  await loadAppSettingsIntoProcessEnv();
  // Production without PIN_AUTO_SCHOOL_IPS: Auto mode can never switch PIN sign-in on. Say so once.
  warnIfNoSchoolNetwork();
  registerCleverRoutes();
  await registerGoogleStrategy();
  await ensureAllGroup();

  if (redisClient) {
    logger.info({ redisUrl }, 'Connecting to Redis session store');
    await redisClient.connect();
  } else {
    logger.warn('Redis session store disabled (development mode). Using in-memory sessions.');
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    logger.info({ port: PORT }, 'Server running');
    // The extensions' periodic work, once the server is up (none under NODE_ENV=test).
    startTimers(ext().timers);
    isGoogleOAuthConfigured()
      .then((configured) => {
        if (!configured) {
          logger.warn('GOOGLE_CLIENT_ID not set. Visit /setup to configure OAuth.');
        }
      })
      .catch((error) => {
        logger.warn({ err: error }, 'Failed to evaluate Google OAuth configuration state');
      });
  });
}

startServer().catch((error) => {
  logger.error({ err: error }, 'Failed to start server');
  process.exit(1);
});

export type { AppRouter } from './routers/index.js';
