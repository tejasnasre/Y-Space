import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { test, uniqueLinkedin } from './support/space-fixture';

describe('moderation', { session: 'admin' }, () => {
  test('shows reports and blocked profiles', async ({ app, screen }) => {
    await app.open('/admin/moderation');

    await expect(screen.getByRole('heading', 'Moderation')).toBeVisible();
    await expect(screen.getByTestId('tab-reports')).toBeVisible();
    await expect(screen.getByTestId('tab-blocked')).toBeVisible();
  });

  test('blocks a profile from the block form', async ({ app, screen, profiles }) => {
    const linkedin = uniqueLinkedin();
    profiles.track(linkedin);

    await app.open('/admin/moderation');
    await screen.getByTestId('tab-blocked').tap();
    await screen.getByTestId('block-url').fill(linkedin);
    await screen.getByLabel('Name (optional)').fill('E2E Blocked Person');
    await screen.getByLabel('Reason (optional, only you see it)').fill('E2E test block');
    await screen.getByTestId('block-submit').tap();

    await expect(screen.getByTestId('blocks')).toContainText('E2E Blocked Person');
    await expect(screen.getByTestId('blocks')).toContainText('E2E test block');
  });

  test('unblocks a profile', async ({ app, screen, browser, profiles }) => {
    await app.open('/admin/moderation');
    const block = await profiles.block(uniqueLinkedin(), 'E2E Unblock Me', 'E2E test block');
    await browser.reload();

    await screen.getByTestId('tab-blocked').tap();
    await expect(screen.getByTestId(`block-row-${block.id}`)).toContainText('E2E Unblock Me');

    await screen.getByTestId(`unblock-${block.id}`).tap();
    await screen.getByTestId('confirm-unblock').tap();

    await expect(screen.getByTestId(`block-row-${block.id}`)).toBeHidden({ timeout: 15_000 });
  });
});
