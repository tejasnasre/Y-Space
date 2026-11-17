import type { SQL } from "bun";

/** One place in the raise-hand line. `msgId` only ever grows, so sorting by it gives first come, first served. */
export interface QueueEntry {
  msgId: number;
  /** when the hand went up (ms) */
  at: number;
}

/**
 * The line of people waiting to speak. The room keeps a copy of each person's entry so state changes stay instant;
 * this is where the order and the record come from.
 */
export interface SpeakQueue {
  readonly kind: "pgmq" | "memory";
  /** Join the line. Resolves with the person's place. */
  add(spaceId: string, participantId: string): Promise<QueueEntry>;
  /** Leave the line. `archive`: they were dealt with (kept as a record with timestamps). `delete`: they withdrew or left. */
  resolve(msgId: number, how: "archive" | "delete"): Promise<void>;
  /** The space ended: drop everything for it. */
  clear(spaceId: string): Promise<void>;
  /** Boot: nothing from a previous run is still waiting. */
  clearAll(): Promise<void>;
}

const QUEUE = "speak_requests";

/**
 * Durable FIFO on Postgres using the pgmq extension. One queue; every message says which space and person it is for.
 * (Only one space is live at a time, so one queue is enough. It is emptied when a space ends.)
 */
export class PgmqSpeakQueue implements SpeakQueue {
  readonly kind = "pgmq" as const;
  private constructor(private readonly sql: SQL) {}

  /** Returns null when the extension is not installed on this server. */
  static async tryCreate(sql: SQL): Promise<PgmqSpeakQueue | null> {
    const [row] = await sql`select count(*)::int as n from pg_available_extensions where name = 'pgmq'`;
    if (!row.n) return null;
    await sql`create extension if not exists pgmq`;
    await sql`select pgmq.create(${QUEUE})`; // safe to repeat
    return new PgmqSpeakQueue(sql);
  }

  async add(spaceId: string, participantId: string): Promise<QueueEntry> {
    // `::text::jsonb`, not `::jsonb`: Bun would JSON-encode the string a second time and store a string, not an object
    const message = JSON.stringify({ spaceId, participantId });
    const [row] = await this.sql`select * from pgmq.send(${QUEUE}, ${message}::text::jsonb)`;
    return { msgId: Number(row.send), at: Date.now() };
  }

  async resolve(msgId: number, how: "archive" | "delete"): Promise<void> {
    if (how === "archive") await this.sql`select pgmq.archive(${QUEUE}, ${msgId}::bigint)`;
    else await this.sql`select pgmq.delete(${QUEUE}, ${msgId}::bigint)`;
  }

  async clear(spaceId: string): Promise<void> {
    await this.sql`delete from pgmq.q_speak_requests where message->>'spaceId' = ${spaceId}`;
  }

  async clearAll(): Promise<void> {
    await this.sql`select pgmq.purge_queue(${QUEUE})`;
  }
}

/** Same behaviour with no database: used when pgmq is not installed, and for tests of that path. */
export class MemorySpeakQueue implements SpeakQueue {
  readonly kind = "memory" as const;
  private seq = 0;
  async add(): Promise<QueueEntry> {
    return { msgId: ++this.seq, at: Date.now() };
  }
  async resolve(): Promise<void> {}
  async clear(): Promise<void> {}
  async clearAll(): Promise<void> {}
}

export async function createSpeakQueue(sql: SQL, mode: "auto" | "memory"): Promise<SpeakQueue> {
  if (mode === "auto") {
    try {
      const queue = await PgmqSpeakQueue.tryCreate(sql);
      if (queue) {
        console.log("[queue] raise-hand queue is running on pgmq (Postgres)");
        return queue;
      }
      console.log("[queue] pgmq is not installed on this database: using the in-memory raise-hand queue");
    } catch (e) {
      console.error("[queue] pgmq could not be set up, using the in-memory raise-hand queue", e);
    }
  }
  return new MemorySpeakQueue();
}
