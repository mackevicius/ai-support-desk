import { expect, test } from '@playwright/test';
import { openHistory, sendReply, submittedReviewAction } from './helpers';

test('a visitor submits a request that another session cannot see', async ({
  browser,
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(
    page.getByRole('link', { name: /Family invitation keeps failing/ }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: /Family invitation keeps failing/ })
    .click();
  await openHistory(page);
  await expect(
    page.getByText(
      'Hand-off: There is not enough clear help article coverage to answer automatically.',
    ),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await page
    .getByRole('link', { name: 'New conversation', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('How do I invite my team?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketUrl = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketUrl}$`));
  await expect(
    page.getByRole('heading', { name: 'How do I invite my team?' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('complementary', { name: 'How the AI decided' })
      .getByText('Open', { exact: true }),
  ).toBeVisible();
  await openHistory(page);
  await expect(page.getByText('Request received')).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveValue(/Could you clarify your request/);

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

test('inbox actions stay disabled while their requests are in flight', async ({
  page,
}) => {
  await page.goto('/');

  async function checkPending(label: string, pendingLabel: string) {
    const actionPath = new URL(page.url()).pathname;
    let releaseRequest: () => void = () => {};
    const heldRequest = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let requests = 0;
    const holdPost = async (route: import('@playwright/test').Route) => {
      if (
        route.request().method() === 'POST' &&
        new URL(route.request().url()).pathname === actionPath
      ) {
        requests += 1;
        await heldRequest;
      }
      await route.continue();
    };
    await page.route('**/*', holdPost);
    try {
      await page
        .getByRole('button', { name: label })
        .click({ noWaitAfter: true });
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

  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('Pending test request');
  const checkSubmit = await checkPending('Send', 'Sending...');
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  await checkSubmit();

  await page.goto('/tickets/1');
  const checkReset = await checkPending('Reset demo', 'Resetting demo...');
  await expect(
    page.getByRole('link', { name: /Pending test request/ }),
  ).toHaveCount(0);
  await checkReset();
});

test('a visitor resets their demo workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/1$/);
  await page.route('**/tickets/1', async (route) => {
    if ((await submittedReviewAction(route.request())) === 'reply') {
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
    await route.continue();
  });
  await sendReply(page, '/tickets/1');
  await page.unroute('**/tickets/1');
  await expect(page.getByRole('article', { name: 'Agent reply' })).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await page
    .getByRole('link', { name: 'New conversation', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('Reset my request');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const submittedUrl = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${submittedUrl}$`));
  // The URL was already the ticket, so wait for the Agent view itself.
  await expect(
    page
      .getByRole('article', { name: 'Request detail' })
      .getByRole('heading', { name: 'Reset my request' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(
    page.getByRole('link', { name: /Reset my request/ }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('complementary', { name: 'How the AI decided' })
      .getByText('Open', { exact: true }),
  ).toHaveText('Open');
  const removed = await page.goto(submittedUrl);
  expect(removed?.status()).toBe(404);
  await page.goto('/tickets/1');
  await expect(
    page.getByRole('article', { name: 'Request detail' }),
  ).toBeVisible();
  await expect(page.getByRole('article', { name: 'Agent reply' })).toHaveCount(
    0,
  );
});
