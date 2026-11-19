import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { adminApi, test, uniqueLinkedin } from './support/space-fixture';

describe('guest join', { session: 'admin' }, () => {
  test('rejects a wrong secret', async ({ app, screen, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createLive();
    await app.open(`/s/${space.id}`);

    await screen.getByLabel('Your name').fill('E2E Guest');
    await screen.getByLabel('LinkedIn profile URL').fill(uniqueLinkedin());
    await screen.getByLabel('Space secret').fill('wrong-secret-000');
    await screen.getByRole('button', 'Join as listener').tap();

    await expect(screen.getByTestId('join-error')).toContainText('That space secret is wrong.');
  });

  test('joins a live space as a listener', async ({ app, screen, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createLive();
    await app.open(`/s/${space.id}`);

    await screen.getByLabel('Your name').fill('E2E Guest');
    await screen.getByLabel('LinkedIn profile URL').fill(uniqueLinkedin());
    await screen.getByLabel('Space secret').fill(space.secret);
    await screen.getByRole('button', 'Join as listener').tap();

    await expect(screen.getByTestId('room-title')).toHaveText(space.title, { timeout: 30_000 });
    await expect(screen.getByTestId('my-role')).toContainText('listener', { timeout: 30_000 });
    await expect(screen.getByTestId('raise-hand')).toBeVisible();
  });

  test('tells guests when the attendee list will be public', async ({ app, screen, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createLive({ publicList: true });
    await app.open(`/s/${space.id}`);

    await expect(screen.getByTestId('join-title')).toHaveText(space.title);
    await expect(screen.getByTestId('public-list-notice')).toContainText('The attendee list will be public');
  });

  test('shows that a space has ended', async ({ app, screen, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createLive();
    await adminApi.end(await spaces.token(), space.id);

    await app.open(`/s/${space.id}`);

    await expect(screen.getByTestId('space-ended')).toContainText('This space has ended.');
  });
});
