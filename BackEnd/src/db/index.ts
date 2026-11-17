import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { join } from "node:path";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

/** Bun's native Postgres client (`Bun.sql`) wrapped by Drizzle. */
export function createDb(url: string) {
  const client = new SQL(url, { max: 10 });
  const db = drizzle({ client, schema });
  return { db, client };
}

/** Apply pending migrations from ./drizzle. Safe to call on every boot. */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: join(import.meta.dir, "../../drizzle") });
}

export { schema };
