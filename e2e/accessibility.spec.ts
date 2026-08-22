import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { freshAccount, signUp } from './helpers';

/**
 * Automated WCAG scan (axe-core) across the pages a new user actually sees.
 * This catches contrast, missing labels, and landmark/heading structure
 * issues mechanically — it is not a substitute for manual screen-reader and
 * keyboard-only passes, which axe cannot do.
 */
async function scan(page: import('@playwright/test').Page) {
  return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
}

function describe(violations: import('axe-core').Result[]): string {
  return violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n  ${v.nodes[0]?.target.join(' ')}`)
    .join('\n');
}

test('the signed-out login page has no automatically detectable WCAG 2 A/AA violations', async ({ page }) => {
  await page.goto('/login');
  const results = await scan(page);
  expect(results.violations, describe(results.violations)).toEqual([]);
});

test('the signed-out signup page has no automatically detectable WCAG 2 A/AA violations', async ({ page }) => {
  await page.goto('/signup');
  const results = await scan(page);
  expect(results.violations, describe(results.violations)).toEqual([]);
});

// One shared signup for every signed-in page, not one per page: `signup` is
// rate-limited to 5/hour per IP (a real anti-abuse limit, not a test
// artifact — see `src/server/actions/auth.ts`), which a signup-per-page loop
// would exhaust immediately.
test('signed-in pages have no automatically detectable WCAG 2 A/AA violations', async ({ page }) => {
  const account = freshAccount('a11y');
  await signUp(page, account);

  for (const path of ['/dashboard', '/outreach', '/assistant', '/settings/ai-providers', '/schedule']) {
    await page.goto(path);
    const results = await scan(page);
    expect(results.violations, `${path}:\n${describe(results.violations)}`).toEqual([]);
  }
});
