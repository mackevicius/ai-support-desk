import { expect, test } from '@playwright/test';

test('only the owner starts a live evaluation while saved results stay public', async ({
  page,
}) => {
  await page.goto('/owner');
  await expect(
    page.getByRole('heading', { name: 'Owner sign in' }),
  ).toBeVisible();
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('link', { name: 'Answer quality', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Answer quality' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Run live evaluation', exact: true })
    .click();
  await expect(page).toHaveURL(/\/quality$/);
  await expect(
    page.getByRole('main').getByText('Live run', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Tests', exact: true }).getByRole('link'),
  ).toHaveCount(20);
  await page.getByRole('link', { name: /known-failure/ }).click();
  await expect(page).toHaveURL(/\/quality\/known-failure$/);
  await expect(
    page
      .getByRole('article')
      .getByText(/tunely-support-v4 · gpt-4o-mini · live/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('navigation', { name: 'Site' })).toHaveText(
    'SupportHow it worksAnswer quality',
  );
  await page.goto('/quality/known-failure');
  await expect(
    page.getByText(/tunely-support-v4 · gpt-4o-mini · live/),
  ).toBeVisible();
  await page.goto('/quality');
  await expect(
    page.getByRole('region', { name: 'Hand-off decisions correct' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Run live evaluation' }),
  ).toHaveCount(0);
});
