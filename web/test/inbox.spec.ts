import { expect, test } from '@playwright/test';

test('a visitor explores saved cases and starts chats from every topic tile', async ({
  page,
}) => {
  await page.goto('/');
  const steps = page.getByRole('region', { name: 'How Tunely Support works' });
  await expect(steps).toContainText('Tell us');
  await expect(steps).toContainText('Get an answer in seconds');
  await expect(steps).toContainText('A person steps in when it matters');
  const conversations = page.getByRole('navigation', {
    name: 'Conversations',
    exact: true,
  });
  await expect(conversations.getByRole('link')).toHaveCount(5);
  await expect(page.getByText('5 live drafts left')).toBeVisible();
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/explore-${viewport.width}.png`,
      fullPage: true,
    });
  }
  await conversations
    .getByRole('link', { name: /Listen to music offline/ })
    .click();
  await expect(
    page.getByRole('article', { name: 'Tunely reply' }),
  ).toContainText('tap Download');
  await expect(page.getByText('5 live drafts left')).toBeVisible();
  const topics = [
    ['Offline downloads', 'How do I download music for offline listening?'],
    [
      'Playback',
      'Why does music stop after my Bluetooth headphones reconnect?',
    ],
    ['Family invitations', 'How do I invite someone to my family plan?'],
    ['Billing', 'I was charged twice for my Tunely plan. Can you help?'],
    ['Playlist imports', 'Can I import playlists from another music service?'],
    ['Devices', 'How do I remove a listening device?'],
    ['Audio quality', 'How do I change audio quality?'],
  ];
  for (const [label, question] of topics) {
    await page
      .getByRole('link', { name: 'New conversation', exact: true })
      .click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page).toHaveURL(/\/tickets\/\d+$/);
    await expect(
      page.getByRole('region', { name: 'Support chat' }),
    ).toContainText(question);
  }
});

test('agent home opens the shared inbox workspace and seat switches keep the selected conversation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/1$/, { timeout: 15000 });
  await expect(
    page.getByRole('complementary', { name: 'Support inbox' }),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Request detail' }),
  ).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: 'How the AI decided' }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'New support request' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Reset demo', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/1$/);
  await page
    .getByRole('link', { name: 'New conversation', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('How do I download music for offline listening?');
  await page
    .getByRole('button', { name: 'Submit request', exact: true })
    .click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page.getByRole('article', { name: 'Request detail' }).getByRole('heading', {
      name: 'How do I download music for offline listening?',
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page
      .getByRole('region', { name: 'Support chat' })
      .getByText('Answered', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page.getByRole('article', { name: 'Request detail' }),
  ).toBeVisible();
  await page.getByRole('link', { name: /^T Tunely/ }).click();
  await expect(page).toHaveURL(/\/tickets\/1$/);
});

test('an agent edits a risky draft, asks for details and delivers a team reply', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('I was charged twice for offline downloads.');
  await page
    .getByRole('button', { name: 'Submit request', exact: true })
    .click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Switch to Agent seat' }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  const trail = page.getByRole('complementary', { name: 'How the AI decided' });
  await expect(
    trail.getByText('Money or account security', { exact: true }),
  ).toBeVisible();
  await expect(trail.getByText('Hand-off', { exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Reply', exact: true })
    .fill('Which dates were the two charges taken?');
  await page
    .getByRole('button', { name: 'Ask for details', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page.getByRole('article', { name: 'Team question' }),
  ).toContainText('Which dates were the two charges taken?');
  await page.getByRole('button', { name: 'Redraft', exact: true }).click();
  await expect(
    page.getByText('3 live drafts left', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/agent-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/agent-phone.png',
    fullPage: true,
  });
  await page
    .getByRole('textbox', { name: 'Reply', exact: true })
    .fill(
      'Our team checked the charges and will contact you about the duplicate.',
    );
  await page
    .getByRole('button', { name: 'Approve in-app reply', exact: true })
    .click();
  await expect(page).not.toHaveURL(new RegExp(`${ticketPath}$`));
  await page
    .getByRole('combobox', { name: 'Filter by status' })
    .selectOption('resolved');
  await expect(
    page.getByRole('link', {
      name: /I was charged twice for offline downloads/,
    }),
  ).toContainText('resolved');
  await expect(
    page.getByRole('link', { name: /Family invitation keeps failing/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Support chat' }),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Request detail' }),
  ).toHaveCount(0);
  await page.goto(ticketPath);
  const chat = page.getByRole('region', { name: 'Support chat' });
  await expect(
    chat.getByText('Replied by our team', { exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole('article', { name: 'Team question' }),
  ).toContainText('Which dates were the two charges taken?');
  await expect(
    chat.getByRole('article', { name: 'Tunely reply' }),
  ).toContainText('Our team checked the charges');
  await chat.getByText('Ticket history', { exact: true }).click();
  await expect(chat.getByText(/Human approved in-app reply/)).toBeVisible();
  const handOffs = chat.getByText(
    'Hand-off: A team member needs to check questions about money or account security.',
    { exact: true },
  );
  await expect(handOffs).toHaveCount(2);
  await expect(handOffs.first()).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page.getByRole('heading', { name: 'Support inbox', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Support chat' })).toHaveCount(
    0,
  );
});

test('a reopened conversation shows its new redraft and suggested priority', async ({
  page,
}) => {
  await page.goto('/');
  const question =
    'How do I use offline downloads and audio quality? redraft review';
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill(question);
  await page
    .getByRole('button', { name: 'Submit request', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Support chat' })
      .getByText('Answered', { exact: true }),
  ).toBeVisible();
  const ticketPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await page.getByRole('button', { name: 'Reopen request' }).click();
  await page.getByRole('button', { name: 'Redraft', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveValue(/Open Settings > Audio quality/);
  await expect(
    page.getByRole('combobox', { name: 'Priority', exact: true }),
  ).toHaveValue('high');
  await expect(
    page
      .getByRole('article', { name: 'Request detail' })
      .getByText('open', { exact: true }),
  ).toBeVisible();
  const trail = page.getByRole('complementary', { name: 'How the AI decided' });
  await expect(
    trail.getByText('Audio quality · high priority', { exact: true }),
  ).toBeVisible();
  await expect(
    trail.getByRole('heading', { name: 'Changing audio quality' }),
  ).toBeVisible();
});

test('a customer gets a covered answer by keyboard and an example answer on a phone', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New support request' }).focus();
  await page.keyboard.type('How do I download music for offline listening?');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const chat = page.getByRole('region', { name: 'Support chat' });
  await expect(chat.getByText('Answered', { exact: true })).toBeVisible();
  await expect(
    chat
      .getByRole('article', { name: 'Tunely reply' })
      .getByText(/Tunely paid plans include offline listening/),
  ).toBeVisible();
  await expect(chat.getByText('4 live drafts left')).toBeVisible();
  await chat.getByText('How was this answered?', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    chat.getByRole('heading', { name: 'Offline downloads' }),
  ).toBeVisible();
  await expect(
    chat.getByText(
      'A help article clearly covers your question, and it does not need a team member to check it.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('link', { name: 'New conversation', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Offline downloads', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Support chat' })
      .getByText('Answered', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('3 live drafts left')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/customer-phone.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/customer-desktop.png',
    fullPage: true,
  });
});

test('uncovered questions hand off and exhausted visitors still start conversations', async ({
  page,
}) => {
  await page.goto('/');
  for (let draft = 0; draft < 6; draft++) {
    if (draft)
      await page
        .getByRole('link', { name: 'New conversation', exact: true })
        .click();
    await page
      .getByRole('textbox', { name: 'New support request' })
      .fill(`Please help with a double charge ${draft}`);
    await page
      .getByRole('button', { name: 'Submit request', exact: true })
      .click();
    const chat = page.getByRole('region', { name: 'Support chat' });
    await expect(
      chat.getByText('With our team', { exact: true }),
    ).toBeVisible();
    await expect(
      chat.getByText('A Tunely team member will reply soon', { exact: true }),
    ).toBeVisible();
    await expect(
      chat.getByRole('button', { name: 'Switch to Agent seat' }),
    ).toBeVisible();
    if (draft === 4)
      await expect(chat.getByRole('status')).toHaveText(
        'Live AI is paused for today',
      );
  }
  await expect(
    page.getByRole('region', { name: 'Support chat' }).getByRole('status'),
  ).toHaveText('Live AI is paused for today');
  await expect(page.getByText('0 live drafts left')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Agent seat' }).click();
  await expect(
    page.getByRole('heading', { name: 'Support inbox' }),
  ).toBeVisible();
});

test('owner inspects quality failures and guests cannot open the quality view', async ({
  page,
}) => {
  await page.goto('/quality');
  await expect(
    page.getByRole('heading', { name: 'Owner sign in' }),
  ).toBeVisible();
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Answer quality' }).click();
  await expect(
    page.getByRole('heading', { name: 'Answer quality' }),
  ).toBeVisible();
  await expect(page.getByText('tunely-support-v2')).toBeVisible();
  for (const name of [
    'internal-direct-leak',
    'internal-uncited-leak',
    'internal-prompt-leak',
  ])
    await expect(
      page.getByRole('link', { name: new RegExp(name) }),
    ).toContainText('Pass');
  await page.getByRole('link', { name: /internal-direct-leak/ }).click();
  await expect(
    page.getByText('internal handoff: pass', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('no internal phrase copied: pass', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Back to quality', exact: true })
    .click();
  await expect(page.getByRole('link', { name: /known-failure/ })).toBeVisible();
  await page.getByRole('link', { name: /known-failure/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Known failure' }),
  ).toBeVisible();
  await expect(page.getByText('When are invoices available?')).toBeVisible();
  await expect(
    page.getByText('Invoices are available before the billing period closes.'),
  ).toBeVisible();
  await expect(
    page.getByText('Invoices are available after the billing period closes.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByText(/Before the billing period closes, invoices are unavailable/)
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Owner sign in' })).toBeVisible();
  await page.goto('/quality/known-failure');
  await expect(
    page.getByRole('heading', { name: 'Owner sign in' }),
  ).toBeVisible();
});

test('owner manages help articles while visitors cannot open the editor', async ({
  page,
}) => {
  await page.goto('/articles');
  await expect(
    page.getByRole('heading', { name: 'Owner sign in' }),
  ).toBeVisible();
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Help articles' }).click();
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
  await expect(page.getByRole('link', { name: 'Owner sign in' })).toBeVisible();
  await page.goto('/articles');
  await expect(
    page.getByRole('heading', { name: 'Owner sign in' }),
  ).toBeVisible();
});

test('internal notes stay private while an agent checks, edits and approves a draft', async ({
  page,
}) => {
  const title = 'Staff playback incident';
  const phrase =
    'The confidential playback workaround requires clearing the device entitlement cache';
  await page.goto('/owner');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Help articles', exact: true }).click();
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
  await page
    .getByRole('button', { name: 'Submit request', exact: true })
    .click();
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
  await page
    .getByRole('button', { name: 'Approve in-app reply', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(page.locator('.internal-copy-warning mark')).toHaveText(phrase);
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
  await page
    .getByRole('button', { name: 'Approve in-app reply', exact: true })
    .click();
  await expect(page).not.toHaveURL(new RegExp(`${ticketPath}$`));
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Support chat' }),
  ).toBeVisible();
  await page.goto(ticketPath);
  await expect(
    chat.getByRole('article', { name: 'Tunely reply' }),
  ).toContainText('Please restart Tunely');
  expect(await page.content()).not.toContain(title);
  expect(await page.content()).not.toContain(phrase);
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
    page.getByRole('heading', { name: 'Saved AI draft' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Owner sign in' })).toBeVisible();
  await page.goto('/tickets/1');
  await expect(
    page.getByRole('button', { name: 'Generate live draft' }),
  ).toHaveCount(0);
});

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
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketUrl = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketUrl}$`));
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

test('a visitor reviews a saved draft, reopens, and moves to the next request', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page
    .getByRole('link', { name: /Family invitation keeps failing/ })
    .click();
  await expect(page.getByText('Saved AI draft', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Family plan invitations' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('complementary', { name: 'How the AI decided' })
      .getByText('Help', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Reply' })
    .fill('Please resend the invitations.');
  await page.getByLabel('Priority').selectOption('normal');
  await page.getByRole('button', { name: 'Approve in-app reply' }).click();
  await expect(page).toHaveURL(/\/tickets\/2$/);
  await page.goto('/tickets/1');
  await expect(
    page
      .getByRole('article', { name: 'Request detail' })
      .getByText('resolved', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Please resend the invitations.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Human approved in-app reply/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Family invitation keeps failing/ }),
  ).toContainText('resolved');
  await page
    .getByRole('link', { name: /Family invitation keeps failing/ })
    .click();
  await page.getByRole('link', { name: 'Next request' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Music stops after Bluetooth reconnects',
    }),
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
  await expect(page).toHaveURL(/\/tickets\/3$/);
  await page.goto('/tickets/2');
  await expect(
    page
      .getByRole('article', { name: 'Request detail' })
      .getByText('resolved', { exact: true }),
  ).toBeVisible();
  await page.goto('/tickets/1');
  await page.getByRole('button', { name: 'Reopen request' }).click();
  await expect(
    page
      .getByRole('article', { name: 'Request detail' })
      .getByText('open', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Human reopened request')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Reply' })
    .fill('Please check the addresses again.');
  await page.getByRole('button', { name: 'Approve in-app reply' }).click();
  await expect(page).toHaveURL(/\/tickets\/3$/);
  await page.goto('/tickets/1');
  await expect(
    page.getByText('Please check the addresses again.', { exact: true }),
  ).toBeVisible();
  await page.goto('/tickets/5');
  await page.getByRole('button', { name: 'Reopen request' }).click();
  await page
    .getByRole('textbox', { name: 'Reply' })
    .fill('Downloaded music stays available offline.');
  await page.getByRole('button', { name: 'Approve in-app reply' }).click();
  await expect(page).toHaveURL(/\/tickets\/3$/);
  await page.goto('/tickets/5');
  await expect(
    page.getByText('Downloaded music stays available offline.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('article', { name: 'Request detail' })
      .getByText('resolved', { exact: true }),
  ).toBeVisible();
});

test('review actions stay disabled while approval is in flight', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  let releaseRequest: () => void = () => {};
  const heldRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let requests = 0;
  await page.route('**/tickets/1', async (route) => {
    const request = route.request();
    const contentType = request.headers()['content-type'] ?? '';
    if (
      request.method() === 'POST' &&
      contentType.startsWith('multipart/form-data')
    ) {
      const formData = await new Response(
        new Uint8Array(request.postDataBuffer() ?? []),
        { headers: { 'content-type': contentType } },
      ).formData();
      const isReview = Array.from(formData.entries()).some(
        ([name, value]) =>
          (name === 'action' || name.endsWith('_action')) &&
          ['approve', 'reject', 'ask'].includes(String(value)),
      );
      if (isReview) {
        requests += 1;
        await heldRequest;
      }
    }
    await route.continue();
  });

  try {
    await page
      .getByRole('button', { name: 'Approve in-app reply' })
      .click({ noWaitAfter: true });
    await expect.poll(() => requests).toBe(1);
    await expect(
      page.getByRole('button', { name: /Approving/ }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Reject suggestion' }),
    ).toBeDisabled();
    await page.evaluate(() => {
      (
        document.querySelector('.review-form button') as HTMLButtonElement
      ).click();
      (
        document.querySelector(
          '.review-controls form:last-child button',
        ) as HTMLButtonElement
      ).click();
    });
    expect(requests).toBe(1);
  } finally {
    releaseRequest();
  }
  await expect(
    page.getByRole('link', { name: /Family invitation keeps failing/ }),
  ).toContainText('resolved');
  expect(requests).toBe(1);
});

test('inbox actions stay disabled while their requests are in flight', async ({
  page,
}) => {
  await page.goto('/');

  async function checkPending(label: string, pendingLabel: string) {
    let releaseRequest: () => void = () => {};
    const heldRequest = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let requests = 0;
    const holdPost = async (route: import('@playwright/test').Route) => {
      if (
        route.request().method() === 'POST' &&
        new URL(route.request().url()).pathname === '/'
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
  const checkSubmit = await checkPending(
    'Submit request',
    'Submitting request...',
  );
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  await checkSubmit();

  await page.goto('/');
  const checkReset = await checkPending('Reset demo', 'Resetting demo...');
  await expect(
    page.getByRole('link', { name: /Pending test request/ }),
  ).toHaveCount(0);
  await checkReset();
});

test('a visitor resets only their own demo workspace', async ({
  browser,
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page
    .getByRole('link', { name: /Family invitation keeps failing/ })
    .click();
  await page.getByRole('button', { name: 'Approve in-app reply' }).click();
  await expect(
    page.getByRole('link', { name: /Family invitation keeps failing/ }),
  ).toContainText('resolved');
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await page
    .getByRole('link', { name: 'New conversation', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('Reset my request');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const submittedUrl = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${submittedUrl}$`));

  const otherVisitor = await browser.newContext();
  try {
    const otherPage = await otherVisitor.newPage();
    await otherPage.goto('/');
    await otherPage.getByRole('button', { name: 'Agent', exact: true }).click();
    await otherPage
      .getByRole('link', { name: /Family invitation keeps failing/ })
      .click();
    await otherPage
      .getByRole('button', { name: 'Approve in-app reply' })
      .click();
    await expect(
      otherPage.getByRole('link', {
        name: /Family invitation keeps failing/,
      }),
    ).toContainText('resolved');

    await page.getByRole('button', { name: 'Reset demo' }).click();
    await expect(
      page.getByRole('link', { name: /Reset my request/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: /Family invitation keeps failing/ }),
    ).toContainText('open');
    const removed = await page.goto(submittedUrl);
    expect(removed?.status()).toBe(404);
    await otherPage.reload();
    await expect(
      otherPage.getByRole('link', {
        name: /Family invitation keeps failing/,
      }),
    ).toContainText('resolved');
  } finally {
    await otherVisitor.close();
  }
});
