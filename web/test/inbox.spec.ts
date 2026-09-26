import { expect, test } from '@playwright/test';

test('a visitor submits a request that another session cannot see', async ({
  browser,
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: /Team invitations are not arriving/ }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: /Team invitations are not arriving/ })
    .click();
  await expect(page.getByText('Assigned to the support inbox')).toBeVisible();

  await page.getByRole('link', { name: 'Back to inbox' }).click();
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('How do I invite my team?');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketUrl = new URL(page.url()).pathname;
  await expect(
    page.getByRole('heading', { name: 'How do I invite my team?' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('article', { name: 'Request detail' })
      .getByText('open', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Request received')).toBeVisible();
  await expect(
    page.getByText('No answer draft has been generated for this request.'),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Back to inbox' }).click();
  await expect(
    page.getByRole('link', { name: /How do I invite my team\?/ }),
  ).toBeVisible();

  const otherVisitor = await browser.newContext();
  try {
    const otherPage = await otherVisitor.newPage();
    await otherPage.goto('/');
    await expect(
      otherPage.getByRole('link', { name: /How do I invite my team\?/ }),
    ).toHaveCount(0);
    const denied = await otherPage.goto(ticketUrl);
    expect(denied?.status()).toBe(404);
  } finally {
    await otherVisitor.close();
  }
});
