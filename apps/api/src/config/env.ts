import { resolve } from 'node:path';

/**
 * The repo-root `.env` is the single place to configure both apps. Resolved
 * relative to the cwd so it works whether the API is started from the repo root
 * or from `apps/api`.
 */
export const ENV_FILE_PATHS = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
];
