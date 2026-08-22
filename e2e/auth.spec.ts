import { test, expect } from '@playwright/test';
import { freshAccount, logIn, signOut, signUp } from './helpers';

// signUp() leaves the browser context authenticated, and /login redirects an
// already-signed-in visitor straight to /dashboard — the form never renders.
// Every test below that needs to see /login's form must sign out first.

test.describe('sign up, sign in, sign out', () => {
  test('a new account can sign up, land on the dashboard, sign out, and sign back in', async ({ page }) => {
    const account = freshAccount('auth-golden');

    await signUp(page, account);

    // Dashboard doesn't require onboarding to be complete, so it's reachable immediately.
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back, E2E');

    await signOut(page);

    await logIn(page, account);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back, E2E');
  });

  test('an incorrect password is rejected with a visible error, not a silent failure', async ({ page }) => {
    const account = freshAccount('auth-wrongpw');
    await signUp(page, account);
    await signOut(page);

    await page.goto('/login');
    await page.locator('#email').fill(account.email);
    await page.locator('#password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('an unauthenticated visitor is redirected to login from a protected page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
