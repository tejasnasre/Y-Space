import { SQL } from "bun";
import { createDb, runMigrations } from "../../src/db";
import { Repo } from "../../src/repo";

/**
 * Every test file gets its own throw-away Postgres database on the compose `db` service
 * (`docker compose up -d db`). It uses the credentials from DATABASE_URL.
 */
export async function createTestDatabase(admins: { username: string; password: string }[]) {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error("set DATABASE_URL (see .env.example) and run `docker compose up -d db`");

  const maintenance = new URL(base);
  maintenance.pathname = "/postgres";
  const name = `yspace_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const sql = new SQL(maintenance.toString(), { max: 1 });
  await sql.unsafe(`CREATE DATABASE ${name}`);
  await sql.close();

  const url = new URL(base);
  url.pathname = `/${name}`;

  // seed admins straight in the DB, the same way real admins are created
  const { db, client } = createDb(url.toString());
  await runMigrations(db);
  const repo = new Repo(db);
  for (const a of admins) await repo.createAdmin(a.username, await Bun.password.hash(a.password));
  await client.close();

  return {
    url: url.toString(),
    async drop() {
      const s = new SQL(maintenance.toString(), { max: 1 });
      await s.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await s.close();
    },
  };
}
