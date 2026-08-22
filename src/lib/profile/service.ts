/**
 * Profile reads. Server-only, plain functions (not server actions), so pages
 * can call them directly without crossing the action boundary.
 */
import { eq } from 'drizzle-orm';
import { getDb, isDatabaseConfigured, profiles } from '@/lib/db';
import { emptyProfile, parseProfile, type FullProfile } from './types';

export async function loadProfile(userId: string): Promise<FullProfile> {
  if (!isDatabaseConfigured()) return emptyProfile();
  const rows = await getDb().select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return parseProfile(rows[0] ?? null);
}
