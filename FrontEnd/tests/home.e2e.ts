import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { test } from './support/space-fixture';

describe('public home', () => {
  test('shows the live directory sections', async ({ app, screen }) => {
    await app.open('/');

    await expect(screen.getByRole('heading', 'Live audio spaces, one link away.')).toBeVisible();
    await expect(screen.getByTestId('directory')).toBeVisible();
    await expect(screen.getByRole('heading', 'Live now')).toBeVisible();
    await expect(screen.getByRole('heading', 'Past spaces')).toBeVisible();
  });

  test('sends the host to the sign-in page', async ({ app, screen, browser }) => {
    await app.open('/');

    await screen.getByTestId('go-admin').tap();

    await expect(browser).toHaveURL('/admin');
    await expect(screen.getByText('Admin sign in')).toBeVisible();
  });
});

describe('home directory with a live space', { session: 'admin' }, () => {
  test('lists a live space and joins it', async ({ app, screen, browser, spaces }) => {
    await app.open('/admin');
    const space = await spaces.createLive();

    await app.open('/');

    await expect(screen.getByTestId('directory-live')).toContainText(space.title);
    await screen.getByTestId('directory-join').tap();
    await expect(browser).toHaveURL(`/s/${space.id}`);
    await expect(screen.getByTestId('join-title')).toHaveText(space.title);
  });
});
