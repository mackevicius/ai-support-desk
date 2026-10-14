import { expect, test } from '@playwright/test';
import { submittedReviewAction } from './helpers';

test('owner manages help articles while visitors cannot open the editor', async ({
  page,
}) => {
  await page.goto('/articles');
  await expect(
    page.getByRole('heading', { name: 'Owner sign in' }),
  ).toBeVisible();
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Articles', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Help articles' }),
  ).toBeVisible();
  const add = page.getByRole('region', { name: 'Add article' });
  await add.getByLabel('Title').fill('Orbit access');
  await add.getByLabel('Content').fill('Orbit access starts in Settings.');
  await add.getByRole('button', { name: 'Add article' }).click();
  const editor = page
    .locator('.article-editor')
    .filter({ has: page.locator('input[value="Orbit access"]') });
  await expect(editor).toBeVisible();
  await editor
    .getByLabel('Content')
    .fill('Orbit access requires owner approval.');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/articles',
    ),
    editor.getByRole('button', { name: 'Save article' }).click(),
  ]);
  await page.reload();
  await expect(editor.getByLabel('Content')).toHaveValue(
    'Orbit access requires owner approval.',
  );
  await editor.getByRole('checkbox', { name: /Retired/ }).check();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/articles',
    ),
    editor.getByRole('button', { name: 'Save article' }).click(),
  ]);
  await page.reload();
  await expect(editor.getByRole('checkbox', { name: /Retired/ })).toBeChecked();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('navigation', { name: 'Site' })).toHaveText(
    'SupportHow it worksAnswer quality',
  );
  await page.goto('/articles');
  await expect(
    page.getByRole('heading', { name: 'Owner sign in' }),
  ).toBeVisible();
});

test('internal notes stay private while an agent checks, edits and sends a draft', async ({
  page,
}) => {
  const title = 'Staff playback incident';
  const phrase =
    'The confidential playback workaround requires clearing the device entitlement cache';
  await page.goto('/owner');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Articles', exact: true }).click();
  const add = page.getByRole('region', { name: 'Add article' });
  await add.getByLabel('Document type').selectOption('internal_note');
  await add.getByLabel('Title').fill(title);
  await add.getByLabel('Content').fill(phrase);
  await add.getByRole('button', { name: 'Add article', exact: true }).click();
  const editor = page
    .locator('.article-editor')
    .filter({ has: page.locator(`input[value="${title}"]`) });
  await expect(editor.getByLabel('Document type')).toHaveValue('internal_note');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('What is the staff playback workaround?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketPath = new URL(page.url()).pathname;
  const chat = page.getByRole('region', { name: 'Support chat' });
  await expect(chat.getByText('With our team', { exact: true })).toBeVisible();
  await chat.getByText('How was this answered?', { exact: true }).click();
  await expect(
    chat.getByText('1 internal document used.', { exact: true }),
  ).toBeVisible();
  expect(await page.content()).not.toContain(title);
  expect(await page.content()).not.toContain(phrase);
  const customerResponse = await page.request.get(ticketPath);
  const customerHtml = await customerResponse.text();
  expect(customerHtml).not.toContain(title);
  expect(customerHtml).not.toContain(phrase);
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  const trail = page.getByRole('complementary', { name: 'How the AI decided' });
  await expect(trail.getByRole('heading', { name: title })).toBeVisible();
  await expect(trail.getByText('Internal', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Reply', exact: true }).fill(phrase);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Internal text copied' }),
  ).toBeVisible();
  await expect(page.locator('.internal-copy-warning mark')).toHaveText(phrase);
  await expect(
    page.getByRole('button', { name: 'Send anyway', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/internal-note-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/internal-note-phone.png',
    fullPage: true,
  });
  await page
    .getByRole('textbox', { name: 'Reply', exact: true })
    .fill('Please restart Tunely and try playback again.');
  await expect(page.locator('.internal-copy-warning')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('article', { name: 'Agent reply' }),
  ).toContainText('Please restart Tunely');
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Support chat' }),
  ).toBeVisible();
  await page.goto(ticketPath);
  await expect(
    chat.getByRole('article', { name: 'Agent reply' }),
  ).toContainText('Please restart Tunely');
  expect(await page.content()).not.toContain(title);
  expect(await page.content()).not.toContain(phrase);

  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await page.getByRole('textbox', { name: 'Reply', exact: true }).fill(phrase);
  await expect(
    page.getByRole('button', { name: 'Send anyway', exact: true }),
  ).toBeVisible();
  let releaseCheck: () => void = () => {};
  const heldCheck = new Promise<void>((resolve) => {
    releaseCheck = resolve;
  });
  const holdCheck = async (route: import('@playwright/test').Route) => {
    await heldCheck;
    await route.continue().catch(() => {});
  };
  await page.route(`**${ticketPath}/check`, holdCheck);
  await page
    .getByRole('textbox', { name: 'Reply', exact: true })
    .fill(`Note: ${phrase}`);
  const blocked = page.waitForResponse(
    async (response) =>
      (await submittedReviewAction(response.request())) === 'reply',
  );
  await page.getByRole('button', { name: 'Send anyway', exact: true }).click();
  await blocked;
  releaseCheck();
  await page.unroute(`**${ticketPath}/check`, holdCheck);
  await expect(page.locator('.internal-copy-warning mark')).toHaveText(phrase);
  await expect(
    page.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveValue(`Note: ${phrase}`);
  await expect(page.getByRole('article', { name: 'Agent reply' })).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: 'Send anyway', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Agent reply' })).toHaveCount(
    2,
  );
  await expect(
    page.getByRole('article', { name: 'Agent reply' }).last(),
  ).toContainText(phrase);
});

test('only a signed-in owner sees live generation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/1$/, { timeout: 15000 });
  await expect(
    page.getByRole('button', { name: 'Generate live draft' }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Owner sign in' }).click();
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('main [role="alert"]')).toHaveText(
    'Incorrect password.',
  );
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.goto('/tickets/1');
  await page.getByRole('button', { name: 'Generate live draft' }).click();
  await expect(page.locator('main [role="alert"]')).toHaveText(
    'Live generation is unavailable. Please try again later.',
  );
  await expect(
    page.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveValue(/create a new invitation from Settings > Plan > Family/);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Owner sign in' })).toBeVisible();
  await page.goto('/tickets/1');
  await expect(
    page.getByRole('button', { name: 'Generate live draft' }),
  ).toHaveCount(0);
});
