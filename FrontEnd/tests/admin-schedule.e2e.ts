import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { test } from './support/space-fixture';

describe('scheduled spaces', { session: 'admin' }, () => {
  test('lists a scheduled space under Upcoming', async ({ app, screen, browser, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createScheduled();
    await browser.reload();

    await expect(screen.getByTestId('upcoming')).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByTestId(`upcoming-${space.id}`)).toContainText(space.title);
  });

  test('cancels a scheduled space', async ({ app, screen, browser, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createScheduled();
    await browser.reload();
    await expect(screen.getByTestId(`upcoming-${space.id}`)).toContainText(space.title);

    await screen.getByRole('button', `Actions for ${space.title}`).tap();
    await screen.getByTestId(`cancel-${space.id}`).tap();
    await screen.getByTestId('confirm-cancel').tap();

    await expect(screen.getByTestId(`upcoming-${space.id}`)).toBeHidden({ timeout: 15_000 });
  });
});
