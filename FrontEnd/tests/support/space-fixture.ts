import { test as base } from '@e2e-dev/web';
import type { Browser } from '@e2e-dev/web';

/** The REST API the web app talks to (see lib/api.ts). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export interface ApiSpace {
  id: string;
  title: string;
  secret: string;
  status: 'scheduled' | 'live' | 'ended';
  startedAt: number;
  scheduledFor: number | null;
  endedAt: number | null;
}

export interface ApiBlock {
  id: number;
  linkedinUrl: string;
  name: string;
  reason: string | null;
}

export interface CreateSpaceInput {
  title: string;
  secret?: string;
  scheduledFor?: number;
  autoStart?: boolean;
  publicList?: boolean;
  unlisted?: boolean;
  tags?: string[];
  description?: string;
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const adminApi = {
  current: (token: string) => request<{ space: ApiSpace | null }>(token, '/api/admin/spaces/current'),
  list: (token: string) => request<{ spaces: ApiSpace[] }>(token, '/api/admin/spaces?limit=50'),
  create: (token: string, body: CreateSpaceInput) =>
    request<ApiSpace>(token, '/api/admin/spaces', { method: 'POST', body: JSON.stringify(body) }),
  start: (token: string, id: string) => request<ApiSpace>(token, `/api/admin/spaces/${id}/start`, { method: 'POST' }),
  end: (token: string, id: string) => request<{ ok: true }>(token, `/api/admin/spaces/${id}/end`, { method: 'POST' }),
  cancel: (token: string, id: string) => request<{ ok: true }>(token, `/api/admin/spaces/${id}/cancel`, { method: 'POST' }),
  listBlocks: (token: string) => request<{ blocks: ApiBlock[] }>(token, '/api/admin/blocks'),
  blockLinkedin: (token: string, body: { linkedinUrl: string; name?: string; reason?: string }) =>
    request<ApiBlock>(token, '/api/admin/blocks', { method: 'POST', body: JSON.stringify(body) }),
  unblock: (token: string, id: number) => request<{ ok: true }>(token, `/api/admin/blocks/${id}`, { method: 'DELETE' }),
};

/** The token the admin UI keeps in localStorage, read from the page after `app.open('/admin')`. */
export async function adminToken(browser: Browser): Promise<string> {
  const token = await browser.evaluate(() => localStorage.getItem('yspace.admin.token'));
  if (!token) throw new Error('No admin session in the browser. Open /admin while signed in first.');
  return token;
}

/** End a leftover live space made by these tests. A real space in the way fails loudly instead of being ended. */
export async function ensureNoLiveSpace(token: string): Promise<void> {
  const { space } = await adminApi.current(token);
  if (!space) return;
  if (!space.title.startsWith('E2E ')) {
    throw new Error(`A live space titled "${space.title}" is in the way. End it from /admin, then rerun.`);
  }
  await adminApi.end(token, space.id);
}

/** End or cancel every space this suite created and left behind (used by afterEach in agent tests). */
export async function endLeftoverTestSpaces(token: string): Promise<void> {
  const { spaces } = await adminApi.list(token);
  for (const space of spaces) {
    if (!space.title.startsWith('E2E ')) continue;
    try {
      if (space.status === 'live') await adminApi.end(token, space.id);
      else if (space.status === 'scheduled') await adminApi.cancel(token, space.id);
    } catch {
      // already ended or cancelled
    }
  }
}

let seq = 0;
export function uniqueTitle(label: string): string {
  seq += 1;
  return `E2E ${label} ${Date.now()}-${seq}`;
}

export function uniqueSecret(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function uniqueLinkedin(): string {
  return `https://www.linkedin.com/in/e2e-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

interface SpaceFixture {
  token: () => Promise<string>;
  createLive: (overrides?: Partial<CreateSpaceInput>) => Promise<ApiSpace>;
  createScheduled: (overrides?: Partial<CreateSpaceInput>) => Promise<ApiSpace>;
}

interface ProfileFixture {
  track: (linkedinUrl: string) => void;
  block: (linkedinUrl: string, name: string, reason?: string) => Promise<ApiBlock>;
  unblock: (id: number) => Promise<void>;
}

export const test = base.extend<{ spaces: SpaceFixture; profiles: ProfileFixture }>({
  spaces: async ({ browser }, provide) => {
    let tokenPromise: Promise<string> | undefined;
    const token = () => (tokenPromise ??= adminToken(browser));
    const created: Array<{ id: string; kind: 'live' | 'scheduled' }> = [];

    await provide({
      token,
      async createLive(overrides = {}) {
        const admin = await token();
        await ensureNoLiveSpace(admin);
        const space = await adminApi.create(admin, { title: uniqueTitle('Live'), secret: uniqueSecret(), ...overrides });
        created.push({ id: space.id, kind: 'live' });
        return space;
      },
      async createScheduled(overrides = {}) {
        const admin = await token();
        const space = await adminApi.create(admin, {
          title: uniqueTitle('Scheduled'),
          secret: uniqueSecret(),
          scheduledFor: Date.now() + 86_400_000,
          autoStart: false,
          ...overrides,
        });
        created.push({ id: space.id, kind: 'scheduled' });
        return space;
      },
    });

    for (const space of created) {
      try {
        const admin = await token();
        if (space.kind === 'live') await adminApi.end(admin, space.id);
        else await adminApi.cancel(admin, space.id);
      } catch {
        // the test already ended or cancelled it
      }
    }
  },

  profiles: async ({ browser }, provide) => {
    let tokenPromise: Promise<string> | undefined;
    const token = () => (tokenPromise ??= adminToken(browser));
    const tracked = new Set<string>();

    await provide({
      track(linkedinUrl) {
        tracked.add(linkedinUrl);
      },
      async block(linkedinUrl, name, reason) {
        const block = await adminApi.blockLinkedin(await token(), { linkedinUrl, name, reason });
        tracked.add(linkedinUrl);
        return block;
      },
      async unblock(id) {
        await adminApi.unblock(await token(), id);
      },
    });

    for (const linkedinUrl of tracked) {
      try {
        const { blocks } = await adminApi.listBlocks(await token());
        for (const block of blocks) {
          if (block.linkedinUrl === linkedinUrl) await adminApi.unblock(await token(), block.id);
        }
      } catch {
        // the test already removed it
      }
    }
  },
});
