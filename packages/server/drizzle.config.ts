// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { defineConfig } from 'drizzle-kit';

const rawUrl = process.env.DATABASE_URL || './data/flashcards.db';
const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl);
const url = hasScheme ? rawUrl : `file:${rawUrl}`;

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url,
  },
});
