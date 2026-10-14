import { expect, type Page, type Request } from '@playwright/test';

export async function submittedReviewAction(request: Request) {
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

export async function sendReply(page: Page, ticketPath: string) {
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

export async function openHistory(page: Page) {
  await page
    .getByRole('complementary', { name: 'How the AI decided' })
    .getByText('History', { exact: true })
    .click();
}
