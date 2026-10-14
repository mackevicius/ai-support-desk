import { expect, test, type Page } from '@playwright/test';

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
      if (path.startsWith('/quality/')) {
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
  await expect(
    content.getByRole('link', { name: 'Back to inbox' }),
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
      path: `test-results/how-it-works-${viewport.width}.png`,
      fullPage: true,
    });
  }
});
