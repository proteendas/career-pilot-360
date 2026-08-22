import { expect, type Page } from '@playwright/test';

export interface TestAccount {
  name: string;
  email: string;
  password: string;
}

/** A fresh account per test run — avoids collisions across repeated runs against the same dev database. */
export function freshAccount(label: string): TestAccount {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  return {
    name: `E2E ${label}`,
    email: `e2e-${label}-${stamp}@example.com`,
    password: 'correct horse battery staple 42',
  };
}

/**
 * Field lookups use the input `id` directly rather than `getByLabel`: the
 * password field's accessible-name matching collides with the "Show
 * password" toggle button's aria-label in this form, and the id is the
 * unambiguous, stable thing both forms actually guarantee.
 */
export async function signUp(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/signup');
  await page.locator('#name').fill(account.name);
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.getByLabel(/I accept the/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/onboarding', { timeout: 15_000 });
}

export async function logIn(page: Page, account: Pick<TestAccount, 'email' | 'password'>): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/(login)?$/, { timeout: 15_000 });
}
