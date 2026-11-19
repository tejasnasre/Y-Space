import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

test.setup('authenticate as admin', { sessions: ['admin'] }, async ({ app, screen, session }) => {
  const admin = credentials.user('admin');

  await app.open('/admin');
  await screen.getByLabel('Username').fill(admin.username);
  await screen.getByLabel('Password').fill(admin.password);
  await screen.getByRole('button', 'Sign in').tap();

  // Prove the sign-in worked before saving the state every other admin test restores.
  await expect(screen.getByRole('heading', 'Dashboard')).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByRole('button', 'Sign out')).toBeVisible();

  await session.save('admin');
});
