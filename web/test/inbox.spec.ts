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

test('a visitor reviews a saved draft, reopens, and moves to the next request', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('link', { name: /Team invitations are not arriving/ })
    .click();
  await expect(page.getByText('Saved AI draft', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Inviting teammates' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Reply' })
    .fill('Please resend the invitations.');
  await page.getByLabel('Priority').selectOption('normal');
  await page.getByRole('button', { name: 'Approve in-app reply' }).click();
  await expect(page.getByText('resolved', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Please resend the invitations.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Human approved in-app reply/)).toBeVisible();
  await page.getByRole('link', { name: 'Back to inbox' }).click();
  await expect(
    page.getByRole('link', { name: /Team invitations are not arriving/ }),
  ).toContainText('resolved');
  await page
    .getByRole('link', { name: /Team invitations are not arriving/ })
    .click();
  await page.getByRole('link', { name: 'Next request' }).click();
  await expect(
    page.getByRole('heading', { name: 'Where can I download invoices?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reject suggestion' }).click();
  await expect(
    page.getByText('Human rejected saved AI draft and priority suggestion'),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Reply' })
    .fill('I checked the invoice myself.');
  await page.getByRole('button', { name: 'Approve in-app reply' }).click();
  await expect(page.getByText('resolved', { exact: true })).toBeVisible();
  await page.goto('/tickets/1');
  await page.getByRole('button', { name: 'Reopen request' }).click();
  await expect(page.getByText('open', { exact: true })).toBeVisible();
  await expect(page.getByText('Human reopened request')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Reply' })
    .fill('Please check the addresses again.');
  await page.getByRole('button', { name: 'Approve in-app reply' }).click();
  await expect(
    page.getByText('Please check the addresses again.', { exact: true }),
  ).toBeVisible();
  await page.goto('/tickets/4');
  await page.getByRole('button', { name: 'Reopen request' }).click();
  await page
    .getByRole('textbox', { name: 'Reply' })
    .fill('Existing workspace links still work.');
  await page.getByRole('button', { name: 'Approve in-app reply' }).click();
  await expect(
    page.getByText('Existing workspace links still work.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('resolved', { exact: true })).toBeVisible();
});
