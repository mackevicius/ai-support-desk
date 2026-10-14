import { expect, test, type Request } from '@playwright/test';
import { openHistory, sendReply, submittedReviewAction } from './helpers';

test('an agent fills the saved knowledge gap with a private help article and redrafts with its citation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/1$/);
  await page.goto('/tickets/4');
  await expect(
    page.getByRole('heading', { name: 'Knowledge gap', exact: true }),
  ).toBeVisible();
  await page
    .getByText('Write a help article for this', { exact: true })
    .click();
  const editor = page.getByRole('region', {
    name: 'Knowledge gap',
    exact: true,
  });
  await editor
    .getByLabel('Title', { exact: true })
    .fill('Importing Spotify playlists');
  await editor
    .getByLabel('Content', { exact: true })
    .fill(
      'To import playlists from Spotify, open Settings > Music > Import and choose Spotify.',
    );
  await editor
    .getByRole('button', { name: 'Save help article', exact: true })
    .click();
  await expect(
    page.getByText('Help article saved.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('5 live AI answers left today', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Redraft', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveValue(/Settings > Music > Import/);
  await expect(
    page
      .getByRole('complementary', { name: 'How the AI decided' })
      .getByRole('heading', { name: 'Importing Spotify playlists' }),
  ).toBeVisible();
  await expect(
    page.getByText('4 live AI answers left today', { exact: true }),
  ).toBeVisible();
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
      path: `test-results/knowledge-gap-${viewport.width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Support chat' }),
  ).toBeVisible();
});

test('agent home opens the shared inbox workspace and seat switches keep the selected conversation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/1$/, { timeout: 15000 });
  const inbox = page.getByRole('complementary', { name: 'Support inbox' });
  const needsReply = inbox.getByRole('tab', {
    name: 'Needs reply',
    exact: true,
  });
  const allTab = inbox.getByRole('tab', { name: 'All', exact: true });
  await expect(needsReply).toHaveAttribute('aria-selected', 'true');
  await expect(allTab).toHaveAttribute('aria-selected', 'false');
  const openRequests = await inbox.getByRole('link').count();
  await expect(
    inbox.getByRole('link').filter({ hasText: 'Solved' }),
  ).toHaveCount(0);
  await allTab.click();
  await expect(allTab).toHaveAttribute('aria-selected', 'true');
  expect(await inbox.getByRole('link').count()).toBeGreaterThan(openRequests);
  await expect(
    inbox
      .getByRole('link', { name: /Listen to music offline/ })
      .getByText('Solved', { exact: true }),
  ).toBeVisible();
  await needsReply.click();
  await expect(inbox.getByRole('link')).toHaveCount(openRequests);
  await expect(
    page.getByText('AI handed this conversation to you', { exact: true }),
  ).toBeVisible();
  const messages = page.locator('.agent-messages');
  const composer = page.locator('.agent-composer');
  await expect(messages).toBeVisible();
  await expect(composer).toBeVisible();
  const messageBox = await messages.boundingBox();
  const composerBox = await composer.boundingBox();
  expect(composerBox!.y).toBeGreaterThanOrEqual(
    messageBox!.y + messageBox!.height - 1,
  );
  const railBox = await page
    .getByRole('complementary', { name: 'Support inbox' })
    .boundingBox();
  const trailBox = await page
    .getByRole('complementary', { name: 'How the AI decided' })
    .boundingBox();
  expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(messageBox!.x);
  expect(messageBox!.x + messageBox!.width).toBeLessThanOrEqual(trailBox!.x);
  await page.screenshot({ path: 'test-results/agent-app-1440.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/agent-app-390.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page.getByRole('article', { name: 'Request detail' }).getByRole('heading', {
      name: 'How do I download music for offline listening?',
    }),
  ).toBeVisible();
  await expect(inbox.locator('a[aria-current="page"]')).toHaveCount(0);
  await allTab.click();
  await expect(
    inbox
      .locator('a[aria-current="page"]')
      .getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('.agent-messages')
      .getByText('Automatic reply · no review needed', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page
      .getByRole('region', { name: 'Support chat' })
      .getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page.getByRole('article', { name: 'Request detail' }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Tunely · music streaming', exact: true })
    .click();
  await expect(page).toHaveURL(/\/tickets\/1$/);
});

test('an agent sends replies from one box and the customer is left to answer', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('I was charged twice for offline downloads.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Switch to Agent seat' }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  const trail = page.getByRole('complementary', { name: 'How the AI decided' });
  await expect(
    trail.getByText('Money or account security', { exact: true }),
  ).toBeVisible();
  await expect(
    trail.getByRole('heading', { name: 'Handed off to a person', exact: true }),
  ).toBeVisible();
  const detail = page.getByRole('article', { name: 'Request detail' });
  await expect(detail.getByRole('textbox', { name: 'Reply' })).toHaveCount(1);
  await expect(
    detail.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveValue(/\S/);
  const replyBox = (await detail.locator('.reply-row').boundingBox())!;
  const sendButton = (await page
    .getByRole('button', { name: 'Send', exact: true })
    .boundingBox())!;
  expect(sendButton.x).toBeGreaterThan(replyBox.x + replyBox.width / 2);
  expect(sendButton.x + sendButton.width).toBeLessThanOrEqual(
    replyBox.x + replyBox.width,
  );
  expect(sendButton.y + sendButton.height).toBeLessThanOrEqual(
    replyBox.y + replyBox.height,
  );
  await page.getByRole('textbox', { name: 'Reply', exact: true }).fill('   ');
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Reply', exact: true })
    .fill('Which dates were the two charges taken?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page.getByRole('article', { name: 'Agent reply' }),
  ).toContainText('Which dates were the two charges taken?');
  await expect(
    page.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveValue('');
  await page.getByRole('button', { name: 'Redraft', exact: true }).click();
  await expect(
    page
      .getByRole('banner')
      .getByText('3 live AI answers left today', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveValue(/\S/);
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
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Agent reply' })).toHaveCount(
    2,
  );
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    trail.getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Support chat' }),
  ).toBeVisible();
  await page.goto(ticketPath);
  const chat = page.getByRole('region', { name: 'Support chat' });
  await expect(
    chat.locator('header').getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  const replies = chat.getByRole('article', { name: 'Agent reply' });
  await expect(replies.first()).toContainText(
    'Which dates were the two charges taken?',
  );
  await expect(replies.last()).toContainText('Our team checked the charges');
  await expect(
    chat.getByRole('button', { name: 'Solved', exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole('textbox', { name: 'Reply to Tunely' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page.getByRole('heading', { name: 'Support inbox', exact: true }),
  ).toBeVisible();
  const replyEntry = trail
    .locator('.history')
    .getByText(
      'Agent replied: Our team checked the charges and will contact you about the duplicate.',
      { exact: true },
    );
  await expect(replyEntry).toBeHidden();
  await openHistory(page);
  await expect(replyEntry).toBeVisible();
  await expect(
    trail
      .locator('.history')
      .getByText(
        'Hand-off: A team member needs to check something that has gone wrong with your money or account security.',
        { exact: true },
      ),
  ).toHaveCount(2);
});

test('a handed-off conversation shows its new redraft and suggested priority', async ({
  page,
}) => {
  await page.goto('/');
  const question =
    'How do I use offline downloads and audio quality? redraft review';
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill(question);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Support chat' })
      .getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  const ticketPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: /Talk to a person/ }).click();
  await expect(
    page
      .getByRole('region', { name: 'Support chat' })
      .locator('header')
      .getByText('With our team', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page
      .locator('.agent-messages')
      .getByText('Automatic reply · no review needed', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Redraft', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveValue(/Open Settings > Audio quality/);
  await expect(
    page
      .locator('.agent-messages')
      .getByText('Automatic reply · no review needed', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('complementary', { name: 'How the AI decided' })
      .getByText('Open', { exact: true }),
  ).toBeVisible();
  const trail = page.getByRole('complementary', { name: 'How the AI decided' });
  await expect(
    trail.getByText('Audio quality · high priority', { exact: true }),
  ).toBeVisible();
  await expect(
    trail.getByRole('heading', { name: 'Changing audio quality' }),
  ).toBeVisible();
});

test('switching seat still works after navigating during a draft check', async ({
  page,
}) => {
  const isDraftCheck = (request: Request) =>
    request.method() === 'POST' &&
    (request.postData() ?? '').includes('Slow draft check');
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/1$/);
  await page.route('**/tickets/1**', async (route) => {
    if (isDraftCheck(route.request()))
      await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  const checking = page.waitForRequest(isDraftCheck);
  await page
    .getByRole('textbox', { name: 'Reply', exact: true })
    .fill('Slow draft check');
  await checking;
  await page
    .getByRole('link', { name: /Family invitation keeps failing/ })
    .click();
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'New conversation', exact: true }),
  ).toBeVisible({ timeout: 15000 });
});

test('a visitor sends a saved draft, inspects a solved sample, and moves to the next request', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  // Agent seat already lands here; re-clicking the link starts a navigation that swallows the next form action.
  await expect(page).toHaveURL(/\/tickets\/1$/);
  await expect(
    page.getByRole('heading', { name: 'Family plan invitations' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('complementary', { name: 'How the AI decided' })
      .getByText('Help', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Reply' })).toHaveValue(
    /create a new invitation from Settings > Plan > Family/,
  );
  await page
    .getByRole('textbox', { name: 'Reply' })
    .fill('Please resend the invitations.');
  await expect(
    page
      .getByRole('complementary', { name: 'How the AI decided' })
      .getByText('high priority', { exact: true }),
  ).toBeVisible();
  await page.route('**/tickets/1', async (route) => {
    if ((await submittedReviewAction(route.request())) === 'reply') {
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
    await route.continue();
  });
  await sendReply(page, '/tickets/1');
  await page.unroute('**/tickets/1');
  const trail = page.getByRole('complementary', { name: 'How the AI decided' });
  await expect(
    trail.getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  await expect(trail.getByText('high priority', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Agent reply' }),
  ).toContainText('Please resend the invitations.');
  await openHistory(page);
  await expect(
    trail.getByText('Agent replied: Please resend the invitations.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Next request' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Music stops after Bluetooth reconnects',
    }),
  ).toBeVisible();
  await page.goto('/tickets/5');
  await expect(trail.getByText('Solved', { exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Agent reply' })).toHaveCount(
    0,
  );
  await expect(
    page
      .locator('.agent-messages')
      .getByText('Automatic reply · no review needed', { exact: true }),
  ).toBeVisible();
});

test('Send stays disabled while a reply is in flight', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/1$/);
  let releaseRequest: () => void = () => {};
  const heldRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let requests = 0;
  await page.route('**/tickets/1', async (route) => {
    if ((await submittedReviewAction(route.request())) === 'reply') {
      requests += 1;
      await heldRequest;
    }
    await route.continue();
  });

  try {
    await page
      .getByRole('button', { name: 'Send', exact: true })
      .click({ noWaitAfter: true });
    await expect.poll(() => requests).toBe(1);
    await expect(
      page.getByRole('button', { name: 'Sending...' }),
    ).toBeDisabled();
    await page.evaluate(() => {
      (
        document.querySelector('.review-form button') as HTMLButtonElement
      ).click();
    });
    expect(requests).toBe(1);
  } finally {
    releaseRequest();
  }
  await expect(page.getByRole('article', { name: 'Agent reply' })).toHaveCount(
    1,
  );
  await expect(page).toHaveURL(/\/tickets\/1$/);
  expect(requests).toBe(1);
});
