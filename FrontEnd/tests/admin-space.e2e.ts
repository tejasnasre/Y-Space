import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { adminToken, endLeftoverTestSpaces, test, uniqueSecret, uniqueTitle } from './support/space-fixture';

describe('hosting a space', { session: 'admin' }, () => {
  // A space started through the form is unknown to the fixture, so sweep E2E spaces after each test.
  test.afterEach(async ({ browser }) => {
    try {
      await endLeftoverTestSpaces(await adminToken(browser));
    } catch {
      // no page or no session: nothing was created
    }
  });

  test('starts a live space with a join link and secret', async ({ app, screen }) => {
    const title = uniqueTitle('Live');
    const secret = uniqueSecret();

    await app.open('/admin');
    await screen.getByLabel('Title').fill(title);
    await screen.getByLabel('Secret (optional)').fill(secret);
    await screen.getByRole('button', 'Create space').tap();

    const live = screen.getByTestId('live-space');
    await expect(live).toBeVisible({ timeout: 15_000 });
    await expect(live).toContainText(title);
    await expect(screen.getByTestId('join-url')).toHaveValue(new RegExp('/s/[a-z0-9]+$'));
    await expect(screen.getByTestId('space-secret')).toHaveValue(secret);
  });

  test('ends a live space and keeps it in history', async ({ app, screen, browser, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createLive();
    await browser.reload();
    await expect(screen.getByTestId('live-space')).toContainText(space.title);

    await screen.getByTestId('end-from-dashboard').tap();
    await screen.getByTestId('confirm-end-dashboard').tap();

    await expect(screen.getByTestId('live-space')).toBeHidden({ timeout: 15_000 });
    await expect(screen.getByTestId(`history-row-${space.id}`)).toContainText(space.title);
  });

  test('enters the host room for a live space', async ({ app, screen, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createLive();

    await app.open(`/admin/space/${space.id}`);

    await expect(screen.getByTestId('room-title')).toHaveText(space.title, { timeout: 30_000 });
    await expect(screen.getByTestId('my-role')).toContainText('host', { timeout: 30_000 });
    await expect(screen.getByTestId('end-space')).toBeVisible();
  });
});
