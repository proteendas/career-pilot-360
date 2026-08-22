/**
 * Client-safe contact constants. Deliberately has zero server-only imports
 * (no `@/lib/db`, no drizzle) so client components can import from here
 * instead of `contacts.ts` — importing anything from that file into a
 * client component drags the `postgres` driver into the browser bundle.
 */
export const CONTACT_SOURCES = ['user_provided', 'public_company_page', 'authorized_api', 'manual'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const CONTACT_SOURCE_LABELS: Record<ContactSource, string> = {
  user_provided: 'You provided this',
  public_company_page: 'Public company page',
  authorized_api: 'Authorised API',
  manual: 'Entered manually',
};
