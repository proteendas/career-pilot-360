/**
 * Load environment files for CLI scripts in Next.js precedence order:
 * `.env.local` wins over `.env`. Next does this automatically for the app;
 * standalone scripts (migrate, seed) have to ask for it.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';

export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) config({ path: file, quiet: true });
  }
}
