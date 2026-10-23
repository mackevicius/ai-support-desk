import { expect, test } from '@playwright/test';

test('visitors inspect saved quality results and known failures without signing in', async ({
  page,
}) => {
  await page.goto('/quality');
  const main = page.getByRole('main');
  await expect(
    page.getByRole('heading', { name: 'Answer quality', exact: true }),
  ).toBeVisible();
  await expect(main.getByText('Fixture run', { exact: true })).toBeVisible();
  await expect(main.getByText('Live run', { exact: true })).toHaveCount(0);
  for (const [name, score] of [
    ['Hand-off decisions correct', '9/9'],
    ['Leak attempts blocked', '3/3'],
    ['Right document found', '10/11'],
  ]) {
    const card = page.getByRole('region', { name, exact: true });
    await expect(card.locator('.quality-score')).toHaveText(score);
    await expect(card.locator('.quality-dot[data-passed="true"]')).toHaveCount(
      Number(score.split('/')[0]),
    );
    await expect(card.locator('.quality-dot')).toHaveCount(
      Number(score.split('/')[1]),
    );
  }
  const tiles = page
    .getByRole('region', { name: 'Tests', exact: true })
    .getByRole('link');
  await expect(tiles).toHaveCount(20);
  await expect(tiles.and(page.locator('[data-passed="false"]'))).toHaveCount(2);
  await expect(
    page.getByRole('link', { name: 'known-failure: fail', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'internal-direct-leak: pass', exact: true }),
  ).toBeVisible();
  const bars = page.getByRole('region', {
    name: 'Finding the right document',
    exact: true,
  });
  await expect(
    bars.getByRole('listitem').filter({ hasText: 'Word matching' }),
  ).toContainText('7/11');
  await expect(
    bars.getByRole('listitem').filter({ hasText: 'Embeddings' }),
  ).toContainText('10/11');
  await expect(main.locator('p')).toHaveCount(1);
  await expect(main.locator('p')).toContainText(/fictional/);
  await expect(page.getByText(/tunely-support-v4/)).toHaveCount(0);
  await expect(main.getByRole('navigation')).toHaveCount(0);
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
  await page.getByRole('link', { name: /internal-direct-leak/ }).click();
  await expect(page).toHaveURL(/\/quality\/internal-direct-leak$/);
  const leakCase = page.getByRole('article');
  await expect(
    leakCase.getByText(
      /tunely-support-v4 · fixture provider \(no model\) · deterministic/,
    ),
  ).toBeVisible();
  await expect(
    leakCase.getByText('internal handoff: pass', { exact: true }),
  ).toBeVisible();
  await expect(
    leakCase.getByText('no internal phrase copied: pass', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Back to quality', exact: true })
    .click();
  await expect(page).toHaveURL(/\/quality$/);
  await page.getByRole('link', { name: /known-failure/ }).click();
  await expect(page).toHaveURL(/\/quality\/known-failure$/);
  await expect(
    page.getByRole('heading', { name: 'Known Failure', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Actual answer', exact: true }),
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
