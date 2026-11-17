# Y-Space

Self-hosted, small-scale **audio spaces** (think Twitter/X Spaces, but you run it).
A host opens a room, shares a link and a secret, and guests join **without creating an account**. They listen, raise a hand, and the host brings them on stage.

- **Audio only** (Opus), via a mediasoup SFU.
- **One live space at a time**, enforced by a unique index in Postgres. Ended spaces are kept as history.
- **Up to 5 speakers** (host included). Everyone else listens and can raise a hand, chat and react.
- **No guest login.** A guest gives a name, a LinkedIn URL and the space secret.
- **Scheduling.** Book a space for later, optionally auto-start it, and list it publicly.
- **Moderation.** Co-hosts, kick (soft-ban by LinkedIn profile), attendee reports and a block list.
- **Safety nets.** Forgotten spaces end themselves (max duration, host absent, empty room).
- **Attendee lists.** After a space ends, attendees can connect with each other, if the host allows it.

## Repository layout

| Folder | What it is | Stack |
| --- | --- | --- |
| [BackEnd/](BackEnd/) | REST API, socket.io signaling, mediasoup SFU, scheduler | Bun, Elysia, socket.io, mediasoup, Postgres (Drizzle ORM), pg_cron, pgmq |
| [FrontEnd/](FrontEnd/) | Admin dashboard, guest join flow, live room UI | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui (Base UI), mediasoup-client |
| `db-backups/` | Local Postgres dumps (git-ignored, may contain real data) | |

Each folder has its own README with the details:

- [BackEnd/README.md](BackEnd/README.md): full REST + socket.io reference, scheduler, queue, environment, limits.
- [FrontEnd/README.md](FrontEnd/README.md): routes, structure, configuration, scripts.

## How it fits together

```
 Browser (Next.js, :5173)
   │  REST  (admin + guest)         ┐
   │  socket.io  (signaling, chat)  ├──►  API (Bun + Elysia, :3000) ──►  Postgres 17 (+ pg_cron, pgmq)
   │                                ┘          │
   └──  WebRTC audio (UDP/TCP :44444) ◄────────┘  mediasoup SFU
```

- The browser talks to the API over REST and a socket.io connection (roles, speak queue, chat, reactions).
- Audio never goes through the API's HTTP port. It flows over WebRTC to the mediasoup worker on `RTC_PORT`.
- Postgres holds spaces, participants, reports, blocks and admin sessions. `pg_cron` ticks the scheduler and `pgmq` holds the raise-hand line. Both degrade to in-process fallbacks if the extensions are missing.

## Quick start (local development)

You need [Bun](https://bun.sh) (1.4+) and Docker.

```bash
# 1. Backend: database + API
cd BackEnd
bun install                      # first install builds/downloads the mediasoup worker (a few minutes)
cp .env.example .env             # edit POSTGRES_PASSWORD and DATABASE_URL to match
docker compose up -d db          # Postgres only
bun run admin:create <username> <password-min-10-chars>
bun run dev                      # API on http://localhost:3000

# 2. Frontend (new terminal)
cd FrontEnd
bun install
bun run dev                      # http://localhost:5173
```

Then open <http://localhost:5173/admin>, sign in with the admin you just created, start a space, and open the guest link in another browser window.

Migrations run automatically when the API boots.

## Run everything in Docker (API + database)

```bash
cd BackEnd
cp .env.example .env     # set POSTGRES_PASSWORD, RTC_ANNOUNCED_IP (your public IP), PUBLIC_WEB_URL
docker compose up -d --build
docker compose run --rm api bun scripts/create-admin.ts <username> <password>
```

Open `RTC_PORT` (default `44444`) for **both UDP and TCP** in your firewall. The frontend is deployed separately (see [FrontEnd/README.md](FrontEnd/README.md)).

## Going to production

- Browsers only allow microphone access on **HTTPS** (or `localhost`). Put the API and the frontend behind TLS (Caddy or nginx).
- Set `TRUST_PROXY=true` on the API **only** when exactly one reverse proxy sits in front of it. Rate limiting then keys on the last `X-Forwarded-For` hop, which is the address your proxy saw.
- Proxy `/socket.io/` with WebSocket upgrade enabled.
- Set `RTC_ANNOUNCED_IP` to the server's public IP, and `PUBLIC_WEB_URL` to the frontend's public URL.
- Set `CORS_ORIGINS` to your frontend origin instead of leaving it open to all origins.
- Set `NEXT_PUBLIC_API_URL` on the frontend to the API's public URL. It is baked in at build time.
- Keep Postgres on loopback and protect backups: space secrets are stored in plaintext (the host must be able to read them back).

## Testing

```bash
cd BackEnd
bun test            # needs the db container; each test file uses its own throw-away database
bun run typecheck
```

## Known limits (by design)

- One mediasoup worker in one process: no clustering and no recording.
- Rate limits are per IP and in memory, so they reset on restart.
- A kick bans by LinkedIn profile, which is self-declared, so it is a soft ban.

See [BackEnd/README.md](BackEnd/README.md#known-limits-by-design) for the complete list.
