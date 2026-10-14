import { expect, test } from '@playwright/test';
import { openHistory, sendReply } from './helpers';

test('a visitor explores saved cases and starts chats from every topic tile', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'All your music. Help when it skips.' }),
  ).toBeVisible();
  await expect(page.locator('.now-playing[aria-hidden="true"]')).toContainText(
    'Midnight Static',
  );
  const steps = page.getByRole('region', { name: 'How Tunely Support works' });
  await expect(steps).toContainText('Tell us');
  await expect(steps).toContainText('Get an answer in seconds');
  await expect(steps).toContainText('A person steps in when it matters');
  await expect(page.getByText('5 live AI answers left today')).toBeVisible();
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
  await page.goto('/tickets/1');
  const conversations = page.getByRole('navigation', {
    name: 'Conversations',
    exact: true,
  });
  await expect(conversations.getByRole('link')).toHaveCount(5);
  await conversations
    .getByRole('link', { name: /Listen to music offline/ })
    .click();
  await expect(
    page.getByRole('article', { name: 'Tunely reply' }),
  ).toContainText('tap Download');
  await expect(page.getByText('5 live AI answers left today')).toBeVisible();
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
  for (const question of [
    'How do I turn on lossless audio?',
    'My downloads disappeared',
    'My family plan invite link expired',
    'I was charged twice this month',
    'I think my account was hacked',
    'Can I play Tunely in my car?',
  ]) {
    await page
      .getByRole('banner')
      .getByRole('link', { name: 'Tunely · music streaming' })
      .click();
    await page
      .getByRole('region', { name: 'Browse by topic' })
      .getByRole('button', { name: `"${question}" →`, exact: true })
      .click();
    await expect(page).toHaveURL(/\/tickets\/\d+$/);
    await expect(
      page.getByRole('region', { name: 'Support chat' }),
    ).toContainText(question);
  }
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
  await expect(
    chat.locator('header').getByRole('heading', {
      name: 'How do I download music for offline listening?',
      exact: true,
    }),
  ).toBeVisible();
  await expect(chat.locator('header time')).toHaveCount(1);
  const conversations = page.getByRole('navigation', {
    name: 'Conversations',
    exact: true,
  });
  await expect(
    conversations.locator('a[aria-current="page"] time'),
  ).toHaveCount(1);
  await expect(
    chat.getByRole('textbox', { name: 'Reply to Tunely' }),
  ).toBeVisible();
  const customerBubble = await chat
    .getByRole('article', { name: 'Your message' })
    .boundingBox();
  const tunelyBubble = await chat
    .getByRole('article', { name: 'Tunely reply' })
    .boundingBox();
  expect(customerBubble!.x).toBeGreaterThan(tunelyBubble!.x);
  await expect(
    chat.getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  await expect(
    chat
      .getByRole('article', { name: 'Tunely reply' })
      .locator(':scope > div > p')
      .filter({ hasText: /Tunely paid plans include offline listening/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('banner').getByText('4 live AI answers left today'),
  ).toBeVisible();
  const reply = chat.getByRole('article', { name: 'Tunely reply' });
  await reply.getByText('How was this answered?', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    reply.getByText('Automatic reply', { exact: true }),
  ).toBeVisible();
  await expect(reply.getByText('Help article', { exact: true })).toBeVisible();
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
      .getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('3 live AI answers left today')).toBeVisible();
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

test('only the customer marks a conversation solved and starts a new one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/conversations/new');
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('How do I download music for offline listening?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketPath = new URL(page.url()).pathname;
  const chat = page.getByRole('region', { name: 'Support chat' });
  await expect(
    chat.locator('header').getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole('button', { name: 'Solved', exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole('button', { name: /Talk to a person/ }),
  ).toBeVisible();
  await expect(chat.getByText('Ticket history', { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: 'test-results/customer-waiting-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await chat.getByRole('button', { name: 'Solved', exact: true }).click();
  await expect(
    chat.locator('header').getByText('Solved', { exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole('textbox', { name: 'Reply to Tunely' }),
  ).toHaveCount(0);
  await expect(
    chat.getByRole('button', { name: /Talk to a person/ }),
  ).toHaveCount(0);
  await expect(
    chat.getByRole('button', { name: 'Solved', exact: true }),
  ).toHaveCount(0);
  await expect(
    chat.getByRole('link', { name: 'Start a new conversation', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/customer-solved-phone.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/customer-solved-desktop.png',
    fullPage: true,
  });
  await page.reload();
  await expect(
    chat.locator('header').getByText('Solved', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  const detail = page.getByRole('article', { name: 'Request detail' });
  await expect(
    detail.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Reopen request' }),
  ).toHaveCount(0);
  const trail = page.getByRole('complementary', { name: 'How the AI decided' });
  await openHistory(page);
  await expect(
    trail.getByText('Customer marked conversation solved', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(
    chat.getByRole('link', { name: 'Start a new conversation', exact: true }),
  ).toBeVisible();
  await chat
    .getByRole('link', { name: 'Start a new conversation', exact: true })
    .click();
  await expect(page).toHaveURL(/\/conversations\/new$/);
  await expect(
    chat.getByRole('textbox', { name: 'New support request' }),
  ).toBeVisible();
});

test('conversation links immediately announce loading while the next screen is delayed', async ({
  page,
}) => {
  await page.goto('/tickets/1');
  let releaseNavigation!: () => void;
  const navigationBlocked = new Promise<void>((resolve) => {
    releaseNavigation = resolve;
  });
  await page.route('**/tickets/2?*', async (route) => {
    await navigationBlocked;
    await route.continue();
  });
  const conversations = page.getByRole('navigation', {
    name: 'Conversations',
    exact: true,
  });
  const destination = conversations.locator('a[href="/tickets/2"]');
  try {
    await destination.focus();
    await page.keyboard.press('Enter');
    await expect(destination.locator('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(destination.getByRole('status')).toHaveText(
      'Loading conversation...',
    );
    await expect(page).toHaveURL(/\/tickets\/1$/);
  } finally {
    releaseNavigation();
  }
  await expect(page).toHaveURL(/\/tickets\/2$/);
  await expect(conversations.locator('a[aria-current="page"]')).toHaveAttribute(
    'href',
    '/tickets/2',
  );
  await expect(
    page.getByText('Loading conversation...', { exact: true }),
  ).toHaveCount(0);
});

test('a customer asks for a person after an automatic reply and the agent answers', async ({
  page,
}) => {
  const label = "Didn't help? Talk to a person";
  await page.goto('/quality');
  const handOffScore = page
    .getByRole('region', { name: 'Hand-off decisions correct' })
    .locator('.quality-score');
  await expect(handOffScore).toHaveText(/^\d+\/\d+$/);
  const originalScore = await handOffScore.innerText();
  await page.goto('/tickets/1');
  const chat = page.getByRole('region', { name: 'Support chat' });
  await expect(chat.getByText('With our team', { exact: true })).toBeVisible();
  await expect(
    chat.getByRole('button', { name: label, exact: true }),
  ).toHaveCount(0);

  await page.goto('/conversations/new');
  await page
    .getByRole('button', { name: 'Offline downloads', exact: true })
    .click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketPath = new URL(page.url()).pathname;
  const reply = chat.getByRole('article', { name: 'Tunely reply' });
  const handOff = reply.getByRole('button', { name: label, exact: true });
  await expect(handOff).toBeVisible();
  await expect(
    chat.getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  const originalReply = await reply.locator(':scope > div > p').innerText();
  await expect(
    page.getByRole('banner').getByText('4 live AI answers left today'),
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
    await expect(handOff).toBeVisible();
    await page.screenshot({
      path: `test-results/customer-hand-off-${viewport.width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  await handOff.click();
  await expect(chat.getByText('With our team', { exact: true })).toBeVisible();
  await expect(
    chat.getByRole('button', { name: label, exact: true }),
  ).toHaveCount(0);
  await expect(reply.locator(':scope > div > p')).toHaveText(originalReply);
  await expect(chat.getByText('Ticket history', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('banner').getByText('4 live AI answers left today'),
  ).toBeVisible();
  await page.reload();
  await expect(chat.getByText('With our team', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(
    page.getByRole('article', { name: 'Request detail' }),
  ).toBeVisible();
  const inbox = page.getByRole('complementary', { name: 'Support inbox' });
  await expect(
    inbox.getByRole('tab', { name: 'Needs reply', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(inbox.locator(`a[href="${ticketPath}"]`)).toBeVisible();
  const trail = page.getByRole('complementary', {
    name: 'How the AI decided',
  });
  await expect(
    trail
      .locator(':scope > ol')
      .getByText('Customer asked for a person', { exact: true }),
  ).toBeVisible();
  await openHistory(page);
  await expect(
    trail
      .locator('.history')
      .getByText('Customer asked for a person', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Reply', exact: true })
    .fill('Our team has checked your downloads. Please try again.');
  await sendReply(page, ticketPath);
  await expect(
    page.getByRole('article', { name: 'Agent reply' }),
  ).toContainText('Our team has checked your downloads.');
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    chat.locator('header').getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole('article', { name: 'Agent reply' }),
  ).toContainText('Our team has checked your downloads.');
  await expect(
    chat.getByRole('button', { name: label, exact: true }),
  ).toHaveCount(0);
  await expect(reply.locator(':scope > div > p')).toHaveText(originalReply);
  await expect(
    chat.getByRole('button', { name: 'Solved', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('banner').getByText('4 live AI answers left today'),
  ).toBeVisible();

  await page.goto('/quality');
  await expect(handOffScore).toHaveText(originalScore);
});

test('customers reply in the same conversation and the team sees their messages', async ({
  page,
}) => {
  await page.goto('/tickets/1');
  const chat = page.getByRole('region', { name: 'Support chat' });
  const input = chat.getByRole('textbox', { name: 'Reply to Tunely' });
  const box = (await chat
    .locator('.customer-composer .reply-row')
    .boundingBox())!;
  const send = (await chat
    .getByRole('button', { name: 'Send', exact: true })
    .boundingBox())!;
  expect(send.x + send.width).toBeLessThanOrEqual(box.x + box.width);
  expect(send.y + send.height).toBeLessThanOrEqual(box.y + box.height);
  await input.fill(' ');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat.getByRole('alert')).toHaveText(
    'Enter a message of up to 5000 characters.',
  );
  await expect(input).toHaveValue(' ');
  await input.fill('The family invite fails on my phone.');
  await input.press('Tab');
  await page.keyboard.press('Enter');
  await expect(
    chat
      .getByRole('article', { name: 'Your message' })
      .getByText('The family invite fails on my phone.', { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue('');
  await page.reload();
  await expect(
    chat
      .getByRole('article', { name: 'Your message' })
      .getByText('The family invite fails on my phone.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Support inbox' }),
  ).toBeVisible();
  const conversation = page.getByRole('region', {
    name: 'Conversation',
    exact: true,
  });
  await expect(
    conversation.getByText('The family invite fails on my phone.', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Reply', exact: true })
    .fill('Which phone are you using?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    conversation.getByRole('article', { name: 'Agent reply' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(input).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill('An iPhone 16.');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    chat
      .getByRole('article', { name: 'Your message' })
      .getByText('An iPhone 16.', { exact: true }),
  ).toBeVisible();
  const bubbles = chat.locator('.conversation-messages > article');
  const texts = await bubbles.allTextContents();
  expect(
    texts.findIndex((text) => text.includes('The family invite fails')),
  ).toBeLessThan(texts.findIndex((text) => text.includes('Which phone')));
  expect(texts.findIndex((text) => text.includes('Which phone'))).toBeLessThan(
    texts.findIndex((text) => text.includes('An iPhone 16.')),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/customer-reply-phone.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/customer-reply-desktop.png',
    fullPage: true,
  });
});

test('new conversations stay beside the customer conversation list', async ({
  page,
}) => {
  await page.goto('/tickets/1');
  const conversations = page.getByRole('navigation', {
    name: 'Conversations',
    exact: true,
  });
  await expect(conversations.getByRole('link')).toHaveCount(5);
  const newConversation = page.getByRole('link', {
    name: 'New conversation',
    exact: true,
  });
  await newConversation.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/conversations\/new$/);
  await expect(newConversation).toHaveAttribute('aria-current', 'page');
  await expect(conversations.getByRole('link')).toHaveCount(5);
  const chat = page.getByRole('region', { name: 'Support chat' });
  await expect(
    chat.getByText("Hi! I'm Tunely Support. What's going wrong?", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/customer-new-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/customer-new-phone.png',
    fullPage: true,
  });
  await chat
    .getByRole('textbox', { name: 'New support request' })
    .fill('How do I download music for offline listening?');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  await expect(conversations.getByRole('link')).toHaveCount(6);
  await expect(
    chat.getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
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
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const chat = page.getByRole('region', { name: 'Support chat' });
    await expect(
      chat.getByText('With our team', { exact: true }),
    ).toBeVisible();
    await expect(
      chat.getByText('A Tunely team member will reply soon', { exact: true }),
    ).toBeVisible();
    await expect(
      chat
        .locator('[data-from="system"]')
        .getByRole('button', { name: 'Switch to Agent seat' }),
    ).toBeVisible();
    if (draft === 4)
      await expect(chat.getByRole('status')).toHaveText(
        'Live AI is paused for today',
      );
  }
  await expect(
    page.getByRole('region', { name: 'Support chat' }).getByRole('status'),
  ).toHaveText('Live AI is paused for today');
  await expect(page.getByText('0 live AI answers left today')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Agent seat' }).click();
  await expect(
    page.getByRole('heading', { name: 'Support inbox' }),
  ).toBeVisible();
});
