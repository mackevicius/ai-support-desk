import { expect, test } from '@playwright/test';

test('owner manages help articles while visitors cannot open the editor', async ({ page }) => {
  await page.goto('/articles');
  await expect(page.getByRole('heading', { name: 'Owner sign in' })).toBeVisible();
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Help articles' }).click();
  await expect(page.getByRole('heading', { name: 'Help articles' })).toBeVisible();
  const add = page.getByRole('region', { name: 'Add article' });
  await add.getByLabel('Title').fill('Orbit access');
  await add.getByLabel('Content').fill('Orbit access starts in Settings.');
  await add.getByRole('button', { name: 'Add article' }).click();
  const editor = page.locator('.article-editor').filter({ has: page.locator('input[value="Orbit access"]') });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Content').fill('Orbit access requires owner approval.');
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/articles'),
    editor.getByRole('button', { name: 'Save article' }).click(),
  ]);
  await expect(editor.getByLabel('Content')).toHaveValue('Orbit access requires owner approval.');
  await editor.getByRole('checkbox', { name: /Retired/ }).check();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/articles'),
    editor.getByRole('button', { name: 'Save article' }).click(),
  ]);
  await expect(editor.getByRole('checkbox', { name: /Retired/ })).toBeChecked();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Owner sign in' })).toBeVisible();
  await page.goto('/articles');
  await expect(page.getByRole('heading', { name: 'Owner sign in' })).toBeVisible();
});

test('only a signed-in owner sees live generation', async ({ page }) => {
  await page.goto('/tickets/1');
  await expect(page.getByRole('button', { name: 'Generate live draft' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Owner sign in' }).click();
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('main [role="alert"]')).toHaveText('Incorrect password.');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.goto('/tickets/1');
  await page.getByRole('button', { name: 'Generate live draft' }).click();
  await expect(page.locator('main [role="alert"]')).toHaveText('Live generation is unavailable. Please try again later.');
  await expect(page.getByRole('heading', { name: 'Saved AI draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Owner sign in' })).toBeVisible();
  await page.goto('/tickets/1');
  await expect(page.getByRole('button', { name: 'Generate live draft' })).toHaveCount(0);
});

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
  await page.getByRole('textbox', { name: 'Reply' }).fill('');
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

test('review actions stay disabled while approval is in flight', async ({ page }) => {
  await page.goto('/tickets/1');
  let releaseRequest: () => void = () => {};
  const heldRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let requests = 0;
  await page.route('**/tickets/1', async (route) => {
    if (route.request().method() === 'POST') {
      requests += 1;
      await heldRequest;
    }
    await route.continue();
  });

  try {
    await page.getByRole('button', { name: 'Approve in-app reply' }).click({ noWaitAfter: true });
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByRole('button', { name: /Approving/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reject suggestion' })).toBeDisabled();
    await page.evaluate(() => {
      (document.querySelector('.review-form button') as HTMLButtonElement).click();
      (document.querySelector('.review-controls form:last-child button') as HTMLButtonElement).click();
    });
    expect(requests).toBe(1);
  } finally {
    releaseRequest();
  }
  await expect(page.getByText('resolved', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('inbox actions stay disabled while their requests are in flight', async ({ page }) => {
  await page.goto('/');

  async function checkPending(label: string, pendingLabel: string) {
    let releaseRequest: () => void = () => {};
    const heldRequest = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let requests = 0;
    const holdPost = async (route: import('@playwright/test').Route) => {
      if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/') {
        requests += 1;
        await heldRequest;
      }
      await route.continue();
    };
    await page.route('**/*', holdPost);
    try {
      await page.getByRole('button', { name: label }).click({ noWaitAfter: true });
      await expect.poll(() => requests).toBe(1);
      const button = page.getByRole('button', { name: pendingLabel });
      await expect(button).toBeDisabled();
      await button.evaluate((element: HTMLButtonElement) => element.click());
    } finally {
      releaseRequest();
    }
    return async () => {
      expect(requests).toBe(1);
      await page.unroute('**/*', holdPost);
    };
  }

  await page.getByRole('textbox', { name: 'New support request' }).fill('Pending test request');
  const checkSubmit = await checkPending('Submit request', 'Submitting request...');
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  await checkSubmit();

  await page.goto('/');
  const checkReset = await checkPending('Reset demo', 'Resetting demo...');
  await expect(page.getByRole('link', { name: /Pending test request/ })).toHaveCount(0);
  await checkReset();
});

test('a visitor resets only their own demo workspace', async ({ browser, page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Team invitations are not arriving/ }).click();
  await page.getByRole('button', { name: 'Approve in-app reply' }).click();
  await expect(page.getByText('resolved', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to inbox' }).click();
  await page.getByRole('textbox', { name: 'New support request' }).fill('Reset my request');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const submittedUrl = new URL(page.url()).pathname;

  const otherVisitor = await browser.newContext();
  try {
    const otherPage = await otherVisitor.newPage();
    await otherPage.goto('/');
    await otherPage.getByRole('link', { name: /Team invitations are not arriving/ }).click();
    await otherPage.getByRole('button', { name: 'Approve in-app reply' }).click();
    await expect(otherPage.getByText('resolved', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Back to inbox' }).click();
    await page.getByRole('button', { name: 'Reset demo' }).click();
    await expect(page.getByRole('link', { name: /Reset my request/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Team invitations are not arriving/ })).toContainText('open');
    const removed = await page.goto(submittedUrl);
    expect(removed?.status()).toBe(404);
    await otherPage.reload();
    await expect(otherPage.getByText('resolved', { exact: true })).toBeVisible();
  } finally {
    await otherVisitor.close();
  }
});
