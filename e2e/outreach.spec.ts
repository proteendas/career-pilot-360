import { test, expect } from '@playwright/test';
import { freshAccount, signUp } from './helpers';

test('adding a contact requires provenance and then appears in the list', async ({ page }) => {
  const account = freshAccount('outreach');
  await signUp(page, account);
  await page.goto('/outreach');

  await page.getByRole('button', { name: 'Add a contact' }).click();
  await page.locator('#contact-name').fill('Jordan Recruiter');
  await page.locator('#contact-email').fill('jordan@example.com');
  await page.locator('#contact-provenance').fill('Replied to my application email directly.');
  await page.getByRole('button', { name: 'Add contact' }).click();

  await expect(page.getByText('Jordan Recruiter')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('jordan@example.com')).toBeVisible();
});

test('the stop-contact list accepts and removes an address', async ({ page }) => {
  const account = freshAccount('outreach-suppress');
  await signUp(page, account);
  await page.goto('/outreach');

  await page.getByRole('tab', { name: /Stop-contact list/ }).click();
  await page.getByLabel('Add an address').fill('blocked@example.com');
  await page.getByRole('button', { name: 'Add to stop-contact list' }).click();

  await expect(page.getByText('blocked@example.com')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('No addresses on your stop-contact list')).toBeVisible({ timeout: 10_000 });
});
