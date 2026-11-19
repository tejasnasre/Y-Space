import { describe } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
import { test } from './support/space-fixture';

describe('admin sign-in', () => {
  test('rejects a wrong password', async ({ app, screen }) => {
    const admin = credentials.user('admin');

    await app.open('/admin');
    await screen.getByLabel('Username').fill(admin.username);
    await screen.getByLabel('Password').fill('definitely-the-wrong-password');
    await screen.getByRole('button', 'Sign in').tap();

    await expect(screen.getByTestId('login-error')).toContainText('Wrong username or password.');
  });
});

describe('admin session', { session: 'admin' }, () => {
  test('opens the dashboard already signed in', async ({ app, screen }) => {
    await app.open('/admin');

    await expect(screen.getByRole('heading', 'Dashboard')).toBeVisible();
    await expect(screen.getByRole('button', 'Sign out')).toBeVisible();
    await expect(screen.getByTestId('open-moderation')).toBeVisible();
  });

});

// Sign-out revokes the token on the backend, so it signs in with its own token
// instead of the saved 'admin' session every other test restores.
describe('admin sign-out', () => {
  test('signs out back to the form', async ({ app, screen }) => {
    const admin = credentials.user('admin');

    await app.open('/admin');
    await screen.getByLabel('Username').fill(admin.username);
    await screen.getByLabel('Password').fill(admin.password);
    await screen.getByRole('button', 'Sign in').tap();
    await expect(screen.getByRole('button', 'Sign out')).toBeVisible({ timeout: 20_000 });

    await screen.getByRole('button', 'Sign out').tap();

    await expect(screen.getByText('Admin sign in')).toBeVisible();
    await expect(screen.getByTestId('login-submit')).toBeVisible();
  });
});
