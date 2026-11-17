import type { SQL } from "bun";
import type { Config } from "../config";
import type { SpaceManager } from "./space-manager";

const CHANNEL = "yspace_tick";

/**
 * Drives everything that happens "on a clock": the forgotten-space watchdog and opening scheduled spaces.
 *
 * With the pg_cron image (db/Dockerfile) Postgres does the timing: a cron job runs `pg_notify('yspace_tick')`
 * every few seconds and this class LISTENs for it. The real work (closing a room, disconnecting people, opening
 * a room) needs the API process, so cron only wakes it. Hourly SQL-only housekeeping runs inside Postgres.
 *
 * Without pg_cron (another machine, the test databases) or if its ticks stop, a plain in-process timer does the
 * same job, so nothing depends on the extension being there.
 */
export class Scheduler {
  /** who is providing the ticks right now */
  mode: "pg_cron" | "in-process" = "in-process";
  private lastTickAt = 0;
  private running = false;
  private timer?: ReturnType<typeof setInterval>;
  private unlisten?: () => Promise<void>;
  private warnedStalled = false;

  constructor(
    private readonly sql: SQL,
    private readonly manager: SpaceManager,
    private readonly config: Config,
  ) {}

  async start(): Promise<void> {
    try {
      const sub = await this.sql.listen(CHANNEL, () => void this.tick());
      this.unlisten = () => sub.unlisten();
      await this.installCron();
    } catch (e) {
      console.error("[scheduler] LISTEN/pg_cron setup failed, using the in-process timer", e);
      this.mode = "in-process";
    }
    // fallback: runs a tick itself whenever cron's ticks are missing
    this.timer = setInterval(() => void this.fallbackTick(), 30_000);
    this.timer.unref?.();
    void this.tick(); // catch up straight away (a space may have come due while the API was down)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.unlisten?.().catch(() => {});
  }

  /** One pass: end forgotten spaces, warn about ending ones, open scheduled ones that are due. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastTickAt = Date.now();
    try {
      await this.manager.sweep();
      await this.manager.openDue();
    } catch (e) {
      console.error("[scheduler] tick failed", e);
    } finally {
      this.running = false;
    }
  }

  private async fallbackTick(): Promise<void> {
    const staleAfter = this.config.scheduler.tickSeconds * 3_000 + 5_000;
    if (this.mode === "pg_cron" && Date.now() - this.lastTickAt < staleAfter) return; // cron is on time
    if (this.mode === "pg_cron" && !this.warnedStalled) {
      console.warn("[scheduler] pg_cron ticks have stopped; running on the in-process timer until they resume");
      this.warnedStalled = true;
    }
    await this.tick();
  }

  /** Registers the cron jobs when pg_cron is usable for this database. Safe to run on every boot (jobs are upserted by name). */
  private async installCron(): Promise<void> {
    const [row] = await this.sql`
      select (select count(*) from pg_available_extensions where name = 'pg_cron')::int as available,
             current_setting('cron.database_name', true) as cron_db,
             current_database() as db`;
    if (!row.available || row.cron_db !== row.db) {
      console.log("[scheduler] pg_cron is not available for this database: using the in-process timer");
      return;
    }
    try {
      await this.sql`create extension if not exists pg_cron`;
      await this.sql`select cron.schedule(${"yspace-tick"}, ${`${this.config.scheduler.tickSeconds} seconds`}, ${`select pg_notify('${CHANNEL}', '')`})`;
      // SQL-only housekeeping: nothing in the API needs to run for this
      await this.sql`select cron.schedule(${"yspace-prune-sessions"}, ${"7 * * * *"}, ${"delete from admin_sessions where expires_at < now()"})`;
      this.mode = "pg_cron";
      console.log(`[scheduler] pg_cron is driving the clock: a tick every ${this.config.scheduler.tickSeconds}s, hourly session cleanup`);
    } catch (e) {
      console.error("[scheduler] pg_cron is installed but could not be set up, using the in-process timer", e);
    }
  }
}
