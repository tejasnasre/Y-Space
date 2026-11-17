# Y-Space Web (FrontEnd)

The web UI for [Y-Space](../README.md): the host dashboard, the guest join flow and the live audio room.
It talks to the API in [../BackEnd](../BackEnd/README.md) over REST and socket.io, and plays/sends audio with `mediasoup-client`.

**Stack:** Next.js 16 (App Router, `cacheComponents`), React 19, Tailwind CSS 4, shadcn/ui on Base UI, lucide-react, sonner, next-themes, socket.io-client, mediasoup-client. Package manager: Bun.

> This Next.js version has breaking changes compared to older releases. Before changing framework-level code, read the relevant guide in `node_modules/next/dist/docs/` (see [AGENTS.md](AGENTS.md)).

## Getting started

The API must be running first (see [../BackEnd/README.md](../BackEnd/README.md)).

```bash
bun install
bun run dev        # http://localhost:5173
```

Open <http://localhost:5173/admin> and sign in with an admin created via `bun run admin:create` in the backend.

### Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000` | Public URL of the API. It is inlined at **build time**, so set it before `bun run build` |

| `BACKEND_URL` | _(unset)_ | Server-only API origin. When set, REST calls go to this app's own `/api/*` and `/health`, and `next.config.ts` rewrites them to the API, so the browser never sees the API URL for REST. socket.io still connects straight to `NEXT_PUBLIC_API_URL` (Vercel can't proxy WebSockets) |

Put it in `.env.local` (git-ignored):

```bash
NEXT_PUBLIC_API_URL=https://api.example.com
```

The API's `PUBLIC_WEB_URL` must point back at this app, because it is used to build the shareable guest link.
The API's `CORS_ORIGINS` must allow this app's origin.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server on port 5173 |
| `bun run build` | Production build |
| `bun run start` | Serve the production build on port 5173 |
| `bun run lint` | ESLint |

`next.config.ts` allows dev access from a LAN address and `*.ngrok-free.app`, which is handy for testing the microphone from a phone. Browsers only allow mic access on HTTPS or `localhost`, so use a tunnel or TLS for devices other than your own machine. Adjust `allowedDevOrigins` for your own network.

## Routes

| Route | Who | What |
| --- | --- | --- |
| `/` | anyone | Landing page and the directory of public/upcoming spaces |
| `/s/[id]` | guests | Join a space (name, LinkedIn URL, secret), then the live room. Shows a scheduled card before it opens and the attendee list after it ends |
| `/s/[id]/people` | guests | Attendee list of an ended space, if the host shared it |
| `/admin` | host | Sign in, dashboard, start or schedule a space, upcoming spaces, profile |
| `/admin/space/[id]` | host | The host room: stage, raise-hand queue, chat, moderation |
| `/admin/history/[id]` | host | Past space: participants, attendance chart, event timeline |
| `/admin/moderation` | host | Reports from attendees and the block list |

## Project structure

```
app/                    routes (App Router) and global styles
components/
  admin/                dashboard, login, host room, space detail, moderation, invite/profile dialogs
  guest/                join flow, scheduled card, attendee and public lists
  home/                 landing page: space directory, stage diagram
  room/                 live room: chat, reactions, expiry banner, room skeleton
  ui/                   shadcn/ui primitives (generated, edit with care)
hooks/
  use-space-room.ts     socket.io + mediasoup room connection (roles, queue, audio, chat)
  use-stored.ts         localStorage-backed state (e.g. saved guest details)
  use-now.ts            ticking clock for countdowns
lib/
  api.ts                typed REST client and API types (reads NEXT_PUBLIC_API_URL)
  space.ts, stats.ts, tags.ts, utils.ts
public/                 static assets
```

## How the live room works

`hooks/use-space-room.ts` opens a socket.io connection with `auth: { spaceId, token }` (the admin session token for the host, the join token for guests), loads the mediasoup device, creates a receive transport for everyone and a send transport for speakers, and re-establishes media after a reconnect. The full event and signaling reference is in [../BackEnd/README.md](../BackEnd/README.md#socketio).

## Adding UI components

Components come from [shadcn/ui](https://ui.shadcn.com) (config in [components.json](components.json), built on Base UI). Add new ones with:

```bash
bunx shadcn@latest add <component>
```

## Deploying

Build with `bun run build` and run `bun run start`, or deploy to any host that runs Next.js. Remember:

- Set `NEXT_PUBLIC_API_URL` at build time.
- Serve both the app and the API over HTTPS so browsers allow microphone access.
- Make sure the API's firewall allows its `RTC_PORT` (UDP and TCP) for audio.
