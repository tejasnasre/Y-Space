import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { adminApi, test } from './support/space-fixture';

describe('space history', { session: 'admin' }, () => {
  test('opens a finished space with its summary', async ({ app, screen, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createLive();
    await adminApi.end(await spaces.token(), space.id);

    await app.open(`/admin/history/${space.id}`);

    await expect(screen.getByTestId('space-detail')).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByTestId('detail-title')).toHaveText(space.title);
    await expect(screen.getByTestId('tab-people')).toBeVisible();
  });

  test('lists a finished space on the dashboard', async ({ app, screen, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createLive();
    await adminApi.end(await spaces.token(), space.id);

    await app.open('/admin');

    await expect(screen.getByTestId(`history-row-${space.id}`)).toContainText(space.title, { timeout: 15_000 });
  });
});
