import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { claudeCode } from '@e2e-dev/acp';

// The runner loads no env file on its own. Test credentials live in .env.local (git-ignored).
try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: E2E_USER_ADMIN_* or the environment still works
}

export default {
  // The backend allows one live space at a time, so test files run one after another.
  workers: 1,
  // Agent steps run on your local Claude Code over ACP, signed in with `claude` (your Claude
  // subscription) or ANTHROPIC_API_KEY. The Claude Code preset already disables its built-in
  // tools, settings and other MCP servers; only the e2e step tools can act on the app.
  agents: {
    default: {
      executor: claudeCode({
        model: 'sonnet',
        system: 'You are a thorough QA agent. Verify every outcome.',
      }),
      context:
        'Y-Space is a live audio space app. A host signs in at /admin and lands on the Dashboard. ' +
        '"Start a space" has a Title and an optional Secret (6 to 64 characters), then "Create space" starts it live. ' +
        'The live card shows the join link and the secret. "End space" ends it after a confirmation. ' +
        'Guests open /s/<id> and enter "Your name", "LinkedIn profile URL" and "Space secret", then "Join as listener". ' +
        'Inside the room the host badge says "You: host"; a guest badge says "You: listener" and the guest sees "Ask to speak".',
    },
  },
  credentials: {
    admin: {
      username: process.env.E2E_ADMIN_USERNAME ?? 'Tejas',
      // A function defers the 6+ code point check to fill time, so a missing env var fails only the sign-in test.
      password: () => process.env.E2E_ADMIN_PASSWORD ?? '',
    },
  },
  targets: [{
    engine: web(),
    app: {
      url: process.env.APP_URL ?? 'http://localhost:5173',
      // The host room opens the microphone for the host; grant it so the room can connect.
      permissions: { microphone: 'grant' },
      // Or let the runner start the dev server:
      // command: { executable: 'bun', args: ['run', 'dev'] },
    },
  }],
} satisfies E2EConfig;
