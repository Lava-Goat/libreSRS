// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
declare module 'express-session' {
  interface SessionData {
    cleverOAuthState?: string;
    googleClassroomOAuthState?: string;
    googleClassroomAccessToken?: string;
    googleClassroomRefreshToken?: string;
    cleverRosterOAuthState?: string;
    cleverRosterAccessToken?: string;
    /** The page to open after signing in; see services/returnTo.ts. */
    returnTo?: string;
  }
}

export {};

