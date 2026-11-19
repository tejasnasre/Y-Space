import { describe } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
import {
  adminToken,
  endLeftoverTestSpaces,
  ensureNoLiveSpace,
  test,
  uniqueLinkedin,
  uniqueSecret,
  uniqueTitle,
} from './support/space-fixture';

describe('agentic admin flows', () => {
  test.afterEach(async ({ browser }) => {
    try {
      await endLeftoverTestSpaces(await adminToken(browser));
    } catch {
      // no page or no session: nothing was created
    }
  });

  test('signs in with the admin credentials', { timeout: 180_000 }, async ({ app, screen, agent }) => {
    const admin = credentials.user('admin');

    await app.open('/admin');
    await agent.act('sign in with the admin username and password', {
      params: { username: admin.username, password: admin.password },
    });

    await expect(screen.getByRole('heading', 'Dashboard')).toBeVisible({ timeout: 20_000 });
    await expect(screen.getByRole('button', 'Sign out')).toBeVisible();
  });

  test('starts a space from the dashboard', { session: 'admin', timeout: 180_000 }, async ({ app, screen, browser, agent }) => {
    const title = uniqueTitle('Agent');
    const secret = uniqueSecret();

    await app.open('/admin');
    await ensureNoLiveSpace(await adminToken(browser));
    await browser.reload();

    await agent.act('start a space titled {title} using {secret} as the secret', {
      params: { title, secret },
    });

    await expect(screen.getByTestId('live-space')).toContainText(title, { timeout: 30_000 });
    await expect(screen.getByTestId('space-secret')).toHaveValue(secret);
  });
});

describe('agentic guest flows', { session: 'admin' }, () => {
  test('joins a live space as a listener', { timeout: 180_000 }, async ({ app, screen, spaces, agent }) => {
    const name = 'E2E Agent Guest';
    const linkedin = uniqueLinkedin();

    await app.open('/admin');
    const space = await spaces.createLive();
    await app.open(`/s/${space.id}`);

    await agent.act('join the space as {name} with LinkedIn profile {linkedin} and the secret {secret}', {
      params: { name, linkedin, secret: space.secret },
    });

    await expect(screen.getByTestId('room-title')).toHaveText(space.title, { timeout: 40_000 });
    await expect(screen.getByTestId('my-role')).toContainText('listener', { timeout: 40_000 });
  });
});
