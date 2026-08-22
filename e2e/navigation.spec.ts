import { test, expect } from '@playwright/test';
import { freshAccount, signUp } from './helpers';

/**
 * One broad sweep across every page reachable from the nav — the goal is
 * catching a page that 500s or renders a blank error boundary, not deep
 * feature coverage (that belongs in the more targeted specs).
 */
const PAGES: { path: string; heading: string | RegExp }[] = [
  { path: '/dashboard', heading: /Welcome/ },
  { path: '/assistant', heading: 'Assistant' },
  { path: '/resume', heading: 'Resume Center' },
  { path: '/jobs', heading: 'Jobs' },
  { path: '/matches', heading: 'Matches' },
  { path: '/applications', heading: 'Applications' },
  { path: '/outreach', heading: 'Outreach' },
  { path: '/schedule', heading: 'Schedule' },
  { path: '/history', heading: 'History' },
  { path: '/audit', heading: 'Audit log' },
  { path: '/profile', heading: 'Profile' },
  { path: '/settings', heading: 'Settings' },
  { path: '/settings/ai-providers', heading: 'Settings' },
  { path: '/settings/security', heading: 'Settings' },
  { path: '/settings/integrations', heading: 'Settings' },
];

test.describe('every nav-linked page renders', () => {
  test.beforeEach(async ({ page }) => {
    const account = freshAccount('nav');
    await signUp(page, account);
  });

  for (const { path, heading } of PAGES) {
    test(`${path} loads with its heading, not an error boundary`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.ok(), `${path} responded with ${response?.status()}`).toBeTruthy();
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    });
  }
});
