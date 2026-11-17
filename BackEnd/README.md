# Y-Space API (BackEnd)

The server half of [Y-Space](../README.md): REST API, socket.io signaling and the mediasoup SFU.
Bun + Elysia + socket.io (signaling) + mediasoup (SFU) + Postgres (Drizzle ORM on `Bun.sql`).
The web UI lives in [../FrontEnd](../FrontEnd/README.md).

- One live space at a time (enforced by a unique index in the DB). Ended spaces are kept as history.
- Admin logs in (accounts exist only in the DB), creates a space, shares the link + secret.
- Guests join **without login**: name + LinkedIn URL + the space secret. They start as listeners.
- Max 5 speakers including the host. Listeners raise a hand, the host approves.
- Audio only (Opus).
- Admins only see their own spaces, participants and reports. Someone else's space returns `404 space_not_found`.

## Production (no Docker)

The API is a single Bun process; mediasoup is a worker inside it, so there is nothing to containerise. On a small VM it runs
under systemd with Caddy in front for TLS. Postgres is external (Neon) or any reachable Postgres 14+.
See [deploy/](deploy/):

```bash
# on the VM, once
sudo bash deploy/setup-vm.sh              # Bun, systemd unit, Caddy; stops Docker if present
sudo nano /etc/yspace.env                  # DATABASE_URL, RTC_ANNOUNCED_IP, PUBLIC_WEB_URL, CORS_ORIGINS, TRUST_PROXY=true
# from your laptop, every release
./deploy/deploy.sh                         # rsync + bun install + restart + /health check
```

- The API applies pending migrations on boot, so there is no separate migrate step.
- Open `RTC_PORT` (default 44444) for **UDP and TCP** in the OS firewall **and** the cloud provider's network rules. Also 80/443 for Caddy.
- Logs: `journalctl -u yspace-api -f`. Memory is capped by the unit (`MemoryHigh=500M`, `MemoryMax=650M`).
- Create an admin on the VM: `sudo -u yspace bash -c 'set -a; . /etc/yspace.env; cd /opt/yspace && .bun/bin/bun scripts/create-admin.ts <username> <password>'`.

## Run locally

```bash
bun install                # mediasoup builds/downloads its worker on first install (a few minutes)
cp .env.example .env
docker compose up -d db    # just Postgres (or point DATABASE_URL at any Postgres, e.g. Neon)
bun run admin:create <username> <password>    # --reset to change a password
bun run dev                # or: bun run start
bun test                   # needs the db container; each test file uses its own throw-away database
bun run typecheck
```

Browsers need HTTPS (or localhost) for microphone access, so put the API + frontend behind TLS
(Caddy/nginx) and set `TRUST_PROXY=true`. Proxy `/socket.io/` with WebSocket upgrade enabled.

`TRUST_PROXY=true` assumes **exactly one** reverse proxy in front of the API. The rate limiters then key on the **last**
`X-Forwarded-For` entry (the address your proxy saw); earlier entries are client-supplied and ignored. Leave it `false`
when the API is reachable directly, otherwise clients could spoof their IP and dodge the limiters.

## Configuration

Copy [.env.example](.env.example) to `.env` (Bun loads it automatically). Only `DATABASE_URL` is required to boot.

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | – (required) | `postgres://user:pass@host:5432/yspace`. Compose builds it for the `api` container |
| `POSTGRES_PASSWORD` | – | Used by compose for the `db` service (and in `DATABASE_URL`) |
| `PORT` / `API_PORT` | `3000` | API listen port / host port published by compose |
| `PUBLIC_WEB_URL` | `http://localhost:5173` | Frontend URL, used to build the shareable `joinUrl` |
| `CORS_ORIGINS` | `*` | Comma separated origins, or `*`. Restrict this in production |
| `TRUST_PROXY` | `false` | See above |
| `MAX_SPEAKERS` / `MAX_PARTICIPANTS` | `5` / `100` | Stage size (host included) and room size |
| `ADMIN_SESSION_TTL_HOURS` | `72` | Admin session lifetime |
| `RECONNECT_GRACE_SECONDS` | `15` | A dropped socket keeps its role for this long |
| `MAX_SPACE_HOURS`, `HOST_ABSENT_MINUTES`, `EMPTY_ROOM_MINUTES` | `8`, `15`, `30` | Forgotten-space rules (`0` = off), see below |
| `AUTO_END_WARN_MINUTES` / `EXTEND_MINUTES` | `5` / `60` | Warning lead time, and what "keep it going" adds |
| `SPEAK_QUEUE` | `auto` | `auto` uses pgmq when installed, `memory` forces the in-memory line |
| `SCHEDULER_TICK_SECONDS` | `10` | pg_cron tick interval |
| `AUTO_START_GRACE_MINUTES` | `30` | How late an auto-start may still fire |
| `RTC_LISTEN_IP` | `0.0.0.0` | mediasoup bind address |
| `RTC_ANNOUNCED_IP` | first LAN IPv4 | **Set to your public IP in production** (required by compose) |
| `RTC_PORT` | `44444` | The only media port. Open it for UDP **and** TCP |

`GET /health` returns `{ ok, live, scheduler, queue }`: the live space id (or `null`), whether the scheduler runs on `pg_cron`
or `in-process`, and whether the raise-hand queue is `pgmq` or `memory`. Use it for uptime checks.

## Database (Drizzle)

Schema: [src/db/schema.ts](src/db/schema.ts). After changing it: `bun run db:generate`, review the SQL in
`drizzle/`, commit it. Migrations run automatically at boot. A partial unique index on `spaces(status)
WHERE status = 'live'` is what guarantees a single live space.

## REST

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/admin/login` | – | `{username,password}` → `{token,expiresAt,admin}` |
| POST | `/api/admin/logout`, GET `/api/admin/me` | Bearer | `me` returns `{id, username, displayName, linkedinUrl}` |
| PATCH | `/api/admin/me` | Bearer | `{displayName, linkedinUrl}` (null clears): how the host appears to attendees (room, join page, attendee list) |
| POST | `/api/admin/spaces` | Bearer | `{title, secret?, description?, scheduledFor?, publicList?, autoStart?, tags?}` → 201 space incl. `secret` + `joinUrl`; **409 `space_already_live`**. With `scheduledFor` (epoch ms) it is only booked: status `scheduled`, nobody can join yet, no live slot used |
| PATCH | `/api/admin/spaces/:id` | Bearer | edit title / description / `scheduledFor` of a scheduled space (owner only) |
| PATCH | `/api/admin/spaces/:id` (also) | Bearer | `tags`: up to 5 topic words. `#Tech` is saved as `tech`, spaces become dashes, repeats are dropped; more than 5 or odd characters are refused (`invalid_tags`), never silently cut. Shown as `#tech` everywhere the space appears |
| POST | `/api/admin/spaces/:id/start` | Bearer | open a scheduled space (same link + secret). 409 `space_already_live` if another is live |
| POST | `/api/admin/spaces/:id/cancel` | Bearer | cancel a scheduled space (ends with reason `cancelled`) |
| POST | `/api/admin/spaces/:id/extend` | Bearer | "keep it going": adds `EXTEND_MINUTES` and restarts the alone/absent clocks |
| GET | `/api/admin/spaces/current` | Bearer | `{space}` or `{space:null}`, restores admin UI after refresh. Only the caller's own live space |
| GET | `/api/admin/spaces?limit&before` | Bearer | the caller's history, newest first |
| GET | `/api/admin/spaces/:id` | Bearer | space + all participants (name, LinkedIn, times) + event timeline. 404 `space_not_found` unless the caller hosts it |
| POST | `/api/admin/spaces/:id/end` | Bearer | only the admin who created the space (403 otherwise) |
| POST | `/api/admin/spaces/:id/secret` | Bearer | `{secret?}` (6-64 chars) rotates, random if omitted. Host only |
| GET | `/api/spaces/:id` | – | public info (no secret): title, status, counts |
| POST | `/api/spaces/:id/reports` | guest token | `{participantId, reason}` an attendee flags someone to the admin (one report per person, 10 per space) |
| GET | `/api/admin/reports?status=` | Bearer | reports on the caller's own spaces (`open`, `dismissed`, `blocked`) |
| POST | `/api/admin/reports/:id/dismiss`, `/block` | Bearer | resolve a report on one of the caller's spaces; `block` also blocks the reported profile |
| GET/POST | `/api/admin/blocks` | Bearer | blocked profiles. POST `{participantId}` or `{linkedinUrl, name?}` plus `reason?` |
| DELETE | `/api/admin/blocks/:id` | Bearer | unblock |
| GET | `/api/spaces/:id/public-attendees` | – | the attendee list for **anyone**, if the host switched on `publicList` when creating/scheduling the space (guests are told on the join page, `mode: everyone`), or later opened an opt-in list (`mode: optin`: the host plus only guests who chose to appear), and the space has ended. Names, roles and LinkedIn only; removed people, blocked profiles and people with an open report are left out. 403 `not_public`, 409 `space_not_ended` |
| PATCH | `/api/admin/spaces/:id` (also) | Bearer | `autoStart` opens a scheduled space by itself at its time (scheduler above) |
| POST | `/api/admin/spaces/:id/optin-list` | Bearer | `{enabled}`: for an **ended, private** space, open a public list that each guest chooses to appear on (409 `cannot_open_list` otherwise). `false` stops sharing |
| POST | `/api/spaces/:id/share-me` | guest token | `{share}`: a guest chooses whether to appear on the opt-in list (409 `list_not_open` until the host opens it). Removed, blocked and reported people never appear whatever they choose |
| POST | `/api/admin/spaces/:id/public-list` | Bearer | `{enabled}`: off any time; on only while the space is still `scheduled` (409 `cannot_publish`) |
| GET | `/api/spaces/:id/attendees` | guest token | who was in an **ended** space (name, LinkedIn, role, times) so attendees can connect. 409 `space_not_ended` while live, 403 unless the Bearer token is the caller's own join token for that space. Removed guests are left out |
| POST | `/api/spaces/:id/join` | – | `{name, linkedinUrl, secret}` → `{token, participant}` |

Errors are `{error: "<code>", message}`. Join codes: `invalid_secret` 403, `invalid_linkedin_url` 400,
`invalid_name` 400, `banned` 403, `space_ended` 410, `space_not_found` 404, `room_full` 403, `rate_limited` 429.

## Socket.io

```ts
const socket = io(API_URL, {
  auth: { spaceId, token },          // admin session token for the host, join token for guests
  transports: ["websocket"],
});
```

`connect_error.message` is one of `unauthorized | space_not_found | space_ended | banned | room_full`.
On connect the server sends `space:state` → `{space, you, maxSpeakers, participants, requests}`.
Roles: `host | cohost | speaker | listener`. Every request below takes an ack: `{ok:true,...}` or `{ok:false,error}`.

### Audio setup (mediasoup-client)

1. `sfu:getRtpCapabilities` → `{rtpCapabilities}`; `device.load({routerRtpCapabilities})`
2. **Everyone** (to hear): `sfu:createTransport {direction:"recv"}` → params for `device.createRecvTransport`;
   on its `connect` event call `sfu:connectTransport {transportId, dtlsParameters}`;
   then `sfu:ready {rtpCapabilities: device.rtpCapabilities}`.
3. The server then **pushes** `sfu:newConsumer` `{consumerId, producerId, participantId, kind, rtpParameters}`
   for each active speaker (and later ones). Create the consumer with `recvTransport.consume(...)`, attach the
   track to an `<audio>`, and call the ack. The server resumes it after the ack.
   `sfu:consumerClosed {consumerId}` means close that consumer.
4. **Speakers** (role `host`/`speaker`, including right after a `you:role` promotion):
   `sfu:createTransport {direction:"send"}` → `createSendTransport`; `connect` → `sfu:connectTransport`;
   `produce` event → `sfu:produce {transportId, rtpParameters}` → `{producerId}`.
5. On `you:role {role:"listener"}` close the local producer/mic. On socket reconnect (within 15 s you keep your
   role) redo steps 1–4 — media doesn't survive a reconnect.
6. Network change: `sfu:restartIce {transportId}` → `{iceParameters}`.

### Speak flow

| Client → server | Who | |
| --- | --- | --- |
| `speak:request` / `speak:cancel` | listener | raise / lower hand |
| `speak:leave` | speaker | step down |
| `mute:set {muted}` | speaker/host | |
| `host:makeCohost` / `host:removeCohost {participantId}` | host | a co-host moderates (approve, deny, mute, kick listeners) but cannot touch the host or other co-hosts, end the space or extend it. If the host's connection is gone past the grace period, the longest-serving co-host becomes host automatically; the real host gets it back when they return |
| `host:extend` | host | keep the space going after `space:expiring` |
| `chat:send {text}` / `chat:delete {id}` | anyone / moderators | text up to 280 chars, last 100 kept in memory and sent in `space:state.chat` |
| `reaction:send {emoji}` | anyone | one of 👏 ❤️ 🔥 😂 🎉 👍, broadcast as `reaction` |
| `host:approveNext` | host / co-host | approve whoever has waited longest (same rules as `host:promote`) |
| `host:promote {participantId}` | host | approve a request, or invite anyone. `speaker_limit` when 5 are on stage |
| `host:deny` / `host:demote` / `host:mute` / `host:kick {participantId}` | host | kick also bans that LinkedIn profile for this space |
| `host:end` | host | |

| Server → client | |
| --- | --- |
| `space:state` | full snapshot on connect |
| `participant:joined` / `participant:updated` / `participant:left` | roster changes |
| `speak:requested` `{…participant}` / `speak:requestCancelled {participantId}` | host only |
| `you:role {role}` / `you:muted {muted,by}` / `speak:denied` / `kicked` | targeted at one user |
| `speaker:volumes [{participantId,volume}]` | ~800 ms, for "who is talking" rings. `[]` = silence |
| `space:expiring {reason, endsAt}` / `null` | the space will end by itself (`AUTO_END_WARN_MINUTES` ahead). `empty` goes to moderators only; `host_absent` and `max_duration` to everyone |
| `space:host_changed {participantId, name, reason}` | `left` (a co-host took over) or `returned` |
| `chat:message` / `chat:deleted` / `reaction` | chat and reactions |
| `space:ended {reason}` | then the socket is closed |

## Layout

```
index.ts               entrypoint
src/server.ts          composition root (Elysia + socket.io + mediasoup), GET /health
src/config.ts          environment parsing and defaults
src/http/routes.ts     REST
src/realtime/hub.ts    socket.io handlers → Room
src/room/room.ts       roles, speaker limit, request flow, SFU transports/producers/consumers
src/sfu/media.ts       mediasoup worker/router
src/services/          admin auth, space lifecycle + guest join, scheduler, raise-hand queue
src/lib/               errors, validation, rate limiting, security helpers
src/repo.ts            all queries (Drizzle)
src/db/                schema + Bun.sql connection + migrations
drizzle/               generated SQL migrations
db/Dockerfile          Postgres 17 + pg_cron + pgmq
tests/                 bun test suites (each file gets its own throw-away database)
docker-compose.yml     local-dev Postgres only
deploy/                systemd unit, Caddyfile, setup + deploy scripts (no Docker)
scripts/create-admin.ts
```

## Scheduler (pg_cron)

Anything that happens on a clock (the forgotten-space watchdog below, and opening scheduled spaces) is driven by
**Postgres**. The db image is `postgres:17-alpine` plus the `pg_cron` extension ([db/Dockerfile](db/Dockerfile)). At boot the API
registers two cron jobs (idempotent, by name) and `LISTEN`s on a channel:

| Job | Schedule | What it does |
| --- | --- | --- |
| `yspace-tick` | every `SCHEDULER_TICK_SECONDS` (10) | `pg_notify('yspace_tick')`. The API wakes, runs the watchdog and opens scheduled spaces that are due |
| `yspace-prune-sessions` | hourly | deletes expired admin sessions. Pure SQL, the API is not involved |

Why cron only *wakes* the API: ending or opening a space closes/creates the live audio room and disconnects people, which needs
the API process. A cron job can only run SQL.

It degrades safely. Without pg_cron (another machine, the test databases) or if its ticks stop, the API runs the same tick on its
own 30 s timer and logs a warning. `GET /health` reports which one is running: `"scheduler": "pg_cron" | "in-process"`.
Inspect the jobs with `select jobname, schedule, active from cron.job;`.

**Auto-start.** A scheduled space with `autoStart` opens by itself at its time (database clock). Nobody presses a button, so the
host-away timer starts then: the host has `HOST_ABSENT_MINUTES` to show up. If another space is live it waits and is retried each
tick. A space more than `AUTO_START_GRACE_MINUTES` (30) past its time is left for the host to start by hand.

**Switching an existing database to this image.** Data is kept (same Postgres major, same Alpine base, so text sort order is unchanged):
`docker compose up -d --build db`. Do not swap in a Debian-based image on an existing volume: its collation differs. `pg_cron` only
runs in the database named by `cron.database_name` (`yspace`).

## Raise-hand queue (pgmq)

Listeners who press "Ask to speak" join a first-come-first-served line. With the pgmq extension (in the db image) the line lives in
Postgres: one queue, `speak_requests`, one message per waiting hand (`{spaceId, participantId}`). The message id only ever grows, so
sorting by it gives the order, and it survives anything (a host refresh, a reconnect, two devices). Without pgmq (or with
`SPEAK_QUEUE=memory`) an in-memory counter does the same job. `GET /health` shows `"queue": "pgmq" | "memory"`.

| What happens | What the queue does |
| --- | --- |
| `speak:request` | `pgmq.send`. The ack carries `{position, total}` |
| host approves / denies | `pgmq.archive`: kept with `enqueued_at` and `archived_at` (so you can see how long people waited) |
| guest lowers their hand, leaves or is removed | `pgmq.delete`: no record |
| the space ends, or the API boots | the queue is emptied (nobody from a past space is waiting) |

The room mirrors each person's place in memory so state changes stay instant. After every change the server sends hosts the whole
ordered line (`speak:queue`) and each waiting guest their place (`speak:position`); `space:state` carries both. `host:approveNext`
promotes whoever has waited longest. When a seat frees up and someone is waiting, hosts get `speak:seat_free {next}`.
Inspect it with `select msg_id, message from pgmq.q_speak_requests;` and `select * from pgmq.a_speak_requests;`.

## Forgotten spaces

A space the host forgot to end would otherwise stay live forever. A watchdog checks every 30 s and ends it
automatically (`endReason` is stored, and clients get `space:ended {reason}`):

| Rule | Default | `endReason` |
| --- | --- | --- |
| Live longer than `MAX_SPACE_HOURS`, whatever is going on | 8 h | `max_duration` |
| Host not connected for `HOST_ABSENT_MINUTES` (never entered, closed the tab, lost network) | 15 min | `host_absent` |
| Host connected but nobody else for `EMPTY_ROOM_MINUTES` | 30 min | `empty` |

Set a value to `0` to turn that rule off. A host who reconnects resets the host-absent clock. How long a space ran is
`endedAt - createdAt`; the room snapshot also carries `space.startedAt` for a live clock.

## Known limits (by design)

- One mediasoup worker / one process; no clustering, no recording.
- Failed-login / wrong-secret limits are per IP and in memory (reset on restart). Sockets are limited to 60 events / 10 s.
- The block list (`/api/admin/blocks`) is shared by all admins; spaces, participants and reports are per host.
- Space secrets are stored in plaintext in Postgres (the admin must be able to read them back). Keep the db port on loopback and protect backups.
- Request bodies and socket messages are capped at 64 KB.
- A kick bans by LinkedIn profile, which is self-declared, so it is a soft ban.
