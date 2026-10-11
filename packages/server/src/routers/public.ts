// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { router, publicProcedure } from './trpc.js';
import fs from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const publicRouter = router({
  getReadme: publicProcedure.query(async () => {
    try {
      const readmePath = resolve(__dirname, '../../../../README.md');
      const content = await fs.readFile(readmePath, 'utf-8');
      return content;
    } catch (error) {
      logger.error({ err: error }, 'Error reading README.md');
      return '# Error\nCould not load README.md content.';
    }
  }),
});
