import { expect, test, type Page, type Request } from '@playwright/test';

async function submittedReviewAction(request: Request) {
  const contentType = request.headers()['content-type'] ?? '';
  if (
    request.method() !== 'POST' ||
    !contentType.startsWith('multipart/form-data')
  )
    return null;
  const formData = await new Response(
    new Uint8Array(request.postDataBuffer() ?? []),
    { headers: { 'content-type': contentType } },
  ).formData();
  const action = Array.from(formData.entries()).find(
    ([name]) => name === 'action' || name.endsWith('_action'),
  )?.[1];
  return typeof action === 'string' ? action : null;
}

async function sendReply(page: Page, ticketPath: string) {
  const replyResponse = page.waitForResponse(
    async (response) =>
      (await submittedReviewAction(response.request())) === 'reply',
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const sent = await replyResponse;
  expect(sent.status()).toBeLessThan(400);
  expect(
    sent.headers()['x-action-redirect']?.split(';')[0] ??
      sent.headers().location,
  ).toBe(ticketPath);
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
}

async function openHistory(page: Page) {
  await page
    .getByRole('complementary', { name: 'How the AI decided' })
    .getByText('History', { exact: true })
    .click();
}

async function switchToCustomer(page: Page) {
  const pathname = new URL(page.url()).pathname;
  const seatResponse = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'POST' &&
      Boolean(request.headers()['next-action']) &&
      request.postData() === JSON.stringify(['customer', pathname])
    );
  });
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  const selected = await seatResponse;
  expect(selected.status()).toBeLessThan(400);
  expect(
    selected.headers()['x-action-redirect']?.split(';')[0] ??
      selected.headers().location,
  ).toBe('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('button', { name: 'Customer', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
}

async function expectShell(page: Page, drafts: number) {
  await expect(page.getByText('Tunely is a fictional company')).toBeVisible();
  const header = page.getByRole('banner');
  await expect(
    header.getByRole('link', { name: 'Tunely · music streaming' }),
  ).toBeVisible();
  await expect(
    header.getByText(`${drafts} live AI answers left today`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/\d+ (?:live AI )?answers left today/),
  ).toHaveCount(1);
  await expect(header.getByRole('group', { name: 'Viewing as' })).toBeVisible();
  const nav = header.getByRole('navigation', { name: 'Site' });
  const agent =
    (await page.locator('body').getAttribute('data-seat')) === 'agent';
  await expect(
    nav.getByRole('link', { name: agent ? 'Inbox' : 'Support', exact: true }),
  ).toHaveAttribute('href', '/');
  await expect(
    nav.getByRole('link', { name: 'How it works', exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole('link', { name: 'Answer quality', exact: true }),
  ).toBeVisible();
  const path = new URL(page.url()).pathname;
  const current =
    path === '/' || path.startsWith('/tickets/')
      ? '/'
      : path.startsWith('/quality')
        ? '/quality'
        : path;
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(
    path === '/owner' ? 0 : 1,
  );
  if (path !== '/owner') {
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute(
      'href',
      current,
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCSS(
      'text-decoration-line',
      'underline',
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCSS(
      'color',
      'rgb(255, 122, 26)',
    );
  }
  await expect(nav.getByText('Premium', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Portfolio' }).getByRole('link'),
  ).toHaveCount(0);
  for (const link of await nav.locator('a:not([aria-current])').all()) {
    await expect(link).not.toHaveCSS('color', 'rgb(255, 122, 26)');
  }
  const ownerAction = header.getByRole('link', {
    name: 'Owner sign in',
    exact: true,
  });
  const action = (await ownerAction.count())
    ? ownerAction
    : header.getByRole('button', { name: 'Sign out', exact: true });
  await expect(action).not.toHaveCSS('color', 'rgb(255, 122, 26)');
  expect(
    await action.evaluate((element) => {
      const seatSwitch = element
        .closest('.topbar-actions')
        ?.querySelector('[role="group"]');
      return Boolean(
        seatSwitch &&
        seatSwitch.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    nav.getByRole('link', { name: 'Answer quality', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/header-${agent ? 'agent' : 'customer'}-${current.replaceAll('/', '-') || 'home'}-390.png`,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test('Customer seat switch waits for a slow server action', async ({
  page,
}) => {
  await page.goto('/how-it-works');
  await page.context().addCookies([
    {
      name: 'demo_seat',
      value: 'agent',
      url: test.info().project.use.baseURL!,
    },
  ]);
  await page.goto('/how-it-works');
  await expect(
    page.getByRole('button', { name: 'Agent', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.route('**/how-it-works', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().headers()['next-action']
    ) {
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
    await route.continue();
  });
  await switchToCustomer(page);
  await expect(
    page.getByRole('textbox', { name: 'New support request' }),
  ).toBeVisible();
});

test('every page shares active top-bar tabs and only the owner sees Articles', async ({
  page,
}) => {
  for (const path of [
    '/',
    '/how-it-works',
    '/quality',
    '/quality/known-failure',
    '/owner',
  ]) {
    await page.goto(path);
    await expectShell(page, 5);
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Articles' }),
    ).toHaveCount(0);
  }
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'New support request' })
    .fill('How do I download music for offline listening?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  await expectShell(page, 4);
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(
    page.getByRole('article', { name: 'Request detail' }),
  ).toBeVisible();
  await expectShell(page, 4);
  await page.goto('/how-it-works');
  await page
    .getByRole('navigation', { name: 'Site' })
    .getByRole('link', { name: 'Inbox', exact: true })
    .click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  await expect(
    page.getByRole('article', { name: 'Request detail' }),
  ).toBeVisible();
  await expectShell(page, 4);
  await page.getByRole('link', { name: 'Owner sign in' }).click();
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  for (const path of ['/', '/articles', '/quality', '/how-it-works']) {
    await page.goto(path);
    await expectShell(page, 4);
    await expect(
      page
        .getByRole('banner')
        .getByRole('link', { name: 'Articles', exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Owner sign in' }),
  ).toBeVisible();
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Articles' }),
  ).toHaveCount(0);
  // Agent sign-out lands on / which then redirects to the selected ticket.
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  await page.goto('/how-it-works');
  await switchToCustomer(page);
  await page.goto('/how-it-works');
  await page
    .getByRole('navigation', { name: 'Site' })
    .getByRole('link', { name: 'Support', exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('textbox', { name: 'New support request' }),
  ).toBeVisible();
  await expectShell(page, 4);
});

test('remaining pages use shared surfaces without mobile overflow', async ({
  page,
}) => {
  const pages = [
    ['/owner', 'owner'],
    ['/quality', 'quality'],
    ['/quality?view=retrieval', 'retrieval'],
    ['/quality/known-failure', 'quality-case'],
    ['/how-it-works', 'how-it-works'],
    ['/articles', 'articles'],
  ];
  for (const [path, name] of pages) {
    if (path === '/articles') {
      await page.goto('/owner');
      await page.getByLabel('Password').fill('test-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Sign out' }),
      ).toBeVisible();
    }
    await page.goto(path);
    for (const seat of ['customer', 'agent']) {
      await page
        .context()
        .addCookies([
          { name: 'demo_seat', value: seat, url: new URL(page.url()).origin },
        ]);
      await page.goto(path);
      const main = page.getByRole('main');
      await expect(main.locator('[data-slot="card"]').first()).toBeVisible();
      await expect(
        main.locator('[data-slot="separator"]').first(),
      ).toBeVisible();
      if (path.startsWith('/quality')) {
        await expect(main.locator('[data-slot="badge"]').first()).toBeVisible();
      }
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
          path: `test-results/restyle-${name}-${seat}-${viewport.width}.png`,
        });
      }
    }
  }
});

test('visitors inspect saved quality results and known failures without signing in', async ({
  page,
}) => {
  await page.goto('/quality');
  await expect(
    page.getByRole('heading', { name: 'Answer quality', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/tunely-support-v4/)).toBeVisible();
  await expect(page.getByText(/2026-10-02/)).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Hand-off accuracy' }),
  ).toContainText('8 of 8');
  await expect(
    page.getByRole('region', { name: 'Internal-note leak attempts' }),
  ).toContainText('3 of 3');
  await expect(
    page.getByRole('button', { name: 'Run live evaluation' }),
  ).toHaveCount(0);
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
      path: `test-results/quality-${viewport.width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('link', { name: /known-failure/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Known Failure', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Actual answer', exact: true }),
  ).toBeVisible();
  await page.goto('/quality?view=retrieval');
  await expect(page.getByText(/Word matching: 7\/8/)).toBeVisible();
  await expect(page.getByText(/Embeddings: 8\/8/)).toBeVisible();
  for (const path of [
    '/',
    '/tickets/1',
    '/owner',
    '/quality',
    '/quality/known-failure',
    '/how-it-works',
  ]) {
    await page.goto(path);
    const navigation = page.getByRole('navigation', { name: 'Site' });
    await expect(
      navigation.getByRole('link', { name: 'How it works' }),
    ).toBeVisible();
    await expect(
      navigation.getByRole('link', { name: 'Answer quality' }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole('heading', { name: 'Architecture', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^Vercel runs/)).toBeVisible();
  await expect(page.getByText(/^Docker Compose/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Automatic replies and hand-off/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Vercel and Kubernetes/ }),
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
      path: `test-results/how-it-works-${viewport.width}.png`,
      fullPage: true,
    });
  }
});

test('How it works starts with the customer story before technical details', async ({
  page,
}) => {
  await page.goto('/how-it-works');
  const content = page.getByRole('article');
  await expect(content.getByRole('heading', { level: 2 })).toHaveText([
    'From question to reply',
    'When a person steps in',
    'Architecture',
    'Deployment',
    'Evidence and decisions',
  ]);
  const story = content.getByRole('region', { name: 'From question to reply' });
  await expect(story.getByRole('listitem')).toHaveText([
    /The customer asks.*question/s,
    /The AI finds relevant help articles/s,
    /It replies or hands off.*automatic reply.*support agent/s,
    /A support agent replies.*draft.*edits.*own reply/s,
  ]);
  const handOff = content.getByRole('region', {
    name: 'When a person steps in',
  });
  await expect(handOff).toContainText(
    /refunds.*double charges.*hacked or locked accounts.*fraud/s,
  );
  await expect(handOff).toContainText(
    'Cancelling a plan, updating a card, and changing a password',
  );
  await expect(handOff).toContainText(
    'After an automatic reply, the customer can ask for a person',
  );
  await expect(content.getByRole('link', { name: 'Back to inbox' })).toHaveCount(0);
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
      path: `test-results/how-it-works-${viewport.width}.png`,
      fullPage: true,
    });
  }
});

test('an agent fills the saved knowledge gap with a private help article and redrafts with its citation', async ({
  page,
  browser,
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
  const redraft = page.getByRole('button', { name: 'Redraft', exact: true });
  await expect(redraft).toHaveAttribute('data-variant', 'link');
  await redraft.click();
  await expect(
    page.getByRole('textbox', { name: 'Reply', exact: true }),
  ).toHaveValue(/Settings > Music > Import/);
  await expect(page.getByText('Live AI draft', { exact: true })).toHaveCount(0);
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
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await otherPage.goto('/');
    await otherPage.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(otherPage).toHaveURL(/\/tickets\/1$/);
    await otherPage.goto('/tickets/4');
    await expect(
      otherPage.getByRole('heading', { name: 'Knowledge gap', exact: true }),
    ).toBeVisible();
    await expect(
      otherPage.getByRole('heading', {
        name: 'Importing Spotify playlists',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      otherPage.getByRole('button', { name: 'Redraft', exact: true }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Support chat' }),
  ).toBeVisible();
  await expect(
    page.getByText('Write a help article for this', { exact: true }),
  ).toHaveCount(0);
});

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

test('agent home opens the shared inbox workspace and seat switches keep the selected conversation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/1$/, { timeout: 15000 });
  const inbox = page.getByRole('complementary', { name: 'Support inbox' });
  await expect(
    inbox.getByRole('combobox', { name: 'Filter by status' }),
  ).toHaveCount(0);
  const needsReply = inbox.getByRole('tab', { name: 'Needs reply', exact: true });
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
  const selected = page.locator('.queue a[aria-current="page"]');
  await expect(selected.locator('[data-slot="avatar"]')).toBeVisible();
  await expect(selected.locator('[data-slot="avatar-fallback"]')).toHaveText(
    'MC',
  );
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
  await expect(
    page.locator('.agent-messages').getByText(/Approved.*reply/),
  ).toHaveCount(0);
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
  for (const removed of [
    'Approve in-app reply',
    'Ask for details',
    'Reject suggestion',
  ])
    await expect(page.getByRole('button', { name: removed })).toHaveCount(0);
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
  await expect(trail.getByText('Waiting on customer', { exact: true })).toBeVisible();
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
    chat.locator('header').getByText('Waiting on customer', { exact: true }),
  ).toBeVisible();
  const replies = chat.getByRole('article', { name: 'Agent reply' });
  await expect(replies.first()).toContainText(
    'Which dates were the two charges taken?',
  );
  await expect(replies.last()).toContainText('Our team checked the charges');
  await expect(chat.getByText('Ticket history', { exact: true })).toHaveCount(0);
  await expect(chat.getByRole('button', { name: 'Solved', exact: true })).toBeVisible();
  await expect(chat.getByRole('textbox', { name: 'Reply to Tunely' })).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  await expect(
    page.getByRole('heading', { name: 'Support inbox', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Support chat' })).toHaveCount(
    0,
  );
  const replyEntry = trail.locator('.history').getByText(
    'Agent replied: Our team checked the charges and will contact you about the duplicate.',
    { exact: true },
  );
  await expect(replyEntry).toBeHidden();
  await openHistory(page);
  await expect(replyEntry).toBeVisible();
  await expect(trail.locator('.history').getByText(
    'Hand-off: A team member needs to check something that has gone wrong with your money or account security.',
    { exact: true },
  )).toHaveCount(2);
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
      await expect(page.getByRole('region', { name: 'Support chat' }).locator('header').getByText('With our team', { exact: true })).toBeVisible();
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
    page.getByRole('combobox', { name: 'Priority', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('.agent-messages')
      .getByText('Automatic reply · no review needed', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('.agent-messages')
      .getByText('Approved reply', { exact: true }),
  ).toHaveCount(0);
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
  await expect(chat.getByText('Waiting on customer', { exact: true })).toBeVisible();
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

test('only the customer marks a conversation solved and starts a new one', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/conversations/new');
  await page.getByRole('textbox', { name: 'New support request' }).fill('How do I download music for offline listening?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketPath = new URL(page.url()).pathname;
  const chat = page.getByRole('region', { name: 'Support chat' });
  await expect(chat.locator('header').getByText('Waiting on customer', { exact: true })).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Solved', exact: true })).toBeVisible();
  await expect(chat.getByRole('button', { name: /Talk to a person/ })).toBeVisible();
  await expect(chat.getByText('Ticket history', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/customer-waiting-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await chat.getByRole('button', { name: 'Solved', exact: true }).click();
  await expect(chat.locator('header').getByText('Solved', { exact: true })).toBeVisible();
  await expect(chat.getByRole('textbox', { name: 'Reply to Tunely' })).toHaveCount(0);
  await expect(chat.getByRole('button', { name: /Talk to a person/ })).toHaveCount(0);
  await expect(chat.getByRole('button', { name: 'Solved', exact: true })).toHaveCount(0);
  await expect(chat.getByRole('link', { name: 'Start a new conversation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/customer-solved-phone.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/customer-solved-desktop.png', fullPage: true });
  await page.reload();
  await expect(chat.locator('header').getByText('Solved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ticketPath}$`));
  const detail = page.getByRole('article', { name: 'Request detail' });
  await expect(detail.getByRole('textbox', { name: 'Reply', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reopen request' })).toHaveCount(0);
  const trail = page.getByRole('complementary', { name: 'How the AI decided' });
  await openHistory(page);
  await expect(trail.getByText('Customer marked conversation solved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await expect(chat.getByRole('link', { name: 'Start a new conversation', exact: true })).toBeVisible();
  await chat.getByRole('link', { name: 'Start a new conversation', exact: true }).click();
  await expect(page).toHaveURL(/\/conversations\/new$/);
  await expect(chat.getByRole('textbox', { name: 'New support request' })).toBeVisible();
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
  browser,
}) => {
  const label = "Didn't help? Talk to a person";
  await page.goto('/quality');
  const handOffScore = page
    .getByRole('region', { name: 'Hand-off accuracy' })
    .locator('.quality-summary');
  await expect(handOffScore).toContainText('decisions correct');
  const originalScore = await handOffScore.innerText();
  await page.goto('/tickets/1');
  const chat = page.getByRole('region', { name: 'Support chat' });
  await expect(chat.getByText('With our team', { exact: true })).toBeVisible();
  await expect(
    chat.getByRole('button', { name: label, exact: true }),
  ).toHaveCount(0);

  await page.goto('/conversations/new');
  await page.getByRole('button', { name: 'Offline downloads', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const ticketPath = new URL(page.url()).pathname;
  const reply = chat.getByRole('article', { name: 'Tunely reply' });
  const handOff = reply.getByRole('button', { name: label, exact: true });
  await expect(handOff).toBeVisible();
  await expect(chat.getByText('Waiting on customer', { exact: true })).toBeVisible();
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

  const other = await browser.newPage();
  try {
    await other.goto('/tickets/5');
    await expect(
      other.getByRole('button', { name: label, exact: true }),
    ).toHaveCount(0);
    await expect(other.getByRole('region', { name: 'Support chat' }).getByText('Solved', { exact: true })).toBeVisible();
    await handOff.click();
    await expect(
      chat.getByText('With our team', { exact: true }),
    ).toBeVisible();
    await expect(
      chat.getByRole('button', { name: label, exact: true }),
    ).toHaveCount(0);
    await expect(reply.locator(':scope > div > p')).toHaveText(originalReply);
    await expect(chat.getByText('Ticket history', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('banner').getByText('4 live AI answers left today'),
    ).toBeVisible();
    await page.reload();
    await expect(
      chat.getByText('With our team', { exact: true }),
    ).toBeVisible();

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
    await expect(chat.getByRole('button', { name: 'Solved', exact: true })).toBeVisible();
    await expect(
      page.getByRole('banner').getByText('4 live AI answers left today'),
    ).toBeVisible();

    await other.reload();
    const otherChat = other.getByRole('region', { name: 'Support chat' });
    await expect(
      otherChat.getByText('Solved', { exact: true }),
    ).toBeVisible();
    await expect(
      otherChat.getByRole('button', { name: label, exact: true }),
    ).toHaveCount(0);
    await expect(otherChat.getByText('Ticket history', { exact: true })).toHaveCount(0);
    expect((await other.goto(ticketPath))?.status()).toBe(404);
  } finally {
    await other.close();
  }
  await page.goto('/quality');
  await expect(handOffScore).toHaveText(originalScore);
});

test('customers reply in the same conversation and the team sees their messages', async ({
  page,
}) => {
  await page.goto('/tickets/1');
  const chat = page.getByRole('region', { name: 'Support chat' });
  const input = chat.getByRole('textbox', { name: 'Reply to Tunely' });
  const box = (await chat.locator('.customer-composer .reply-row').boundingBox())!;
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
  await expect(chat.getByText('Waiting on customer', { exact: true })).toBeVisible();
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
  await expect(page.getByText(/tunely-support-v4/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Run live evaluation', exact: true })
    .click();
  await expect(page).toHaveURL(/\/quality\?run=live$/);
  await expect(page.getByText(/^Saved live provider results/)).toBeVisible();
  await expect(
    page.getByText(/tunely-support-v4 · gpt-4o-mini · live/),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Deterministic', exact: true }).click();
  for (const name of [
    'internal-direct-leak',
    'internal-uncited-leak',
    'internal-prompt-leak',
  ])
    await expect(
      page.getByRole('link', { name: new RegExp(name) }),
    ).toContainText('Pass');
  await page.getByRole('link', { name: /internal-direct-leak/ }).click();
  await expect(page).toHaveURL(/\/quality\/internal-direct-leak$/);
  await expect(
    page
      .getByRole('article')
      .getByText('internal handoff: pass', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('article')
      .getByText('no internal phrase copied: pass', { exact: true }),
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
  await expect(page.getByRole('navigation', { name: 'Site' })).toHaveText(
    'SupportHow it worksAnswer quality',
  );
  await page.goto('/quality/known-failure');
  await expect(
    page.getByRole('heading', { name: 'Known Failure', exact: true }),
  ).toBeVisible();
  await page.goto('/quality?run=live');
  await expect(page.getByText(/^Saved live provider results/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Run live evaluation' }),
  ).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
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

test('a visitor sends a saved draft, inspects a solved sample, and moves to the next request', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  // Agent seat already lands here; re-clicking the link starts a navigation that swallows the next form action.
  await expect(page).toHaveURL(/\/tickets\/1$/);
  await expect(page.getByText('Saved AI draft', { exact: true })).toHaveCount(0);
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
    page.getByRole('combobox', { name: 'Priority', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('complementary', { name: 'How the AI decided' })
      .getByText('high priority', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Apply .* priority$/ }),
  ).toHaveCount(0);
  await page.route('**/tickets/1', async (route) => {
    if ((await submittedReviewAction(route.request())) === 'reply') {
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
    await route.continue();
  });
  await sendReply(page, '/tickets/1');
  await page.unroute('**/tickets/1');
  const trail = page.getByRole('complementary', { name: 'How the AI decided' });
  await expect(trail.getByText('Waiting on customer', { exact: true })).toBeVisible();
  await expect(
    trail.getByText('high priority', { exact: true }),
  ).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Reopen request' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Reply' })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Agent reply' })).toHaveCount(0);
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

test('a visitor resets only their own demo workspace', async ({
  browser,
  page,
}) => {
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

  const otherVisitor = await browser.newContext();
  try {
    const otherPage = await otherVisitor.newPage();
    await otherPage.goto('/');
    await otherPage.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(otherPage).toHaveURL(/\/tickets\/1$/);
    await sendReply(otherPage, '/tickets/1');
    await expect(
      otherPage.getByRole('article', { name: 'Agent reply' }),
    ).toHaveCount(1);

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
    await expect(
      page.getByRole('article', { name: 'Agent reply' }),
    ).toHaveCount(0);
    await otherPage.reload();
    await expect(
      otherPage.getByRole('article', { name: 'Agent reply' }),
    ).toHaveCount(1);
  } finally {
    await otherVisitor.close();
  }
});
