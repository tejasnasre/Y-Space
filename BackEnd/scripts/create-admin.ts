/**
 * Add (or reset the password of) an admin straight in the database.
 * Admins can't be created over HTTP on purpose.
 *
 *   bun run admin:create <username> <password>
 *   bun run admin:create <username> <password> --reset
 *   docker compose run --rm api bun scripts/create-admin.ts <username> <password>
 */
import { loadConfig } from "../src/config";
import { createDb, runMigrations } from "../src/db";
import { Repo } from "../src/repo";

const [username, password, flag] = Bun.argv.slice(2);
if (!username || !password) {
  console.error("usage: bun run admin:create <username> <password> [--reset]");
  process.exit(1);
}
if (password.length < 10) {
  console.error("password must be at least 10 characters");
  process.exit(1);
}

const { db, client } = createDb(loadConfig().databaseUrl);
try {
  await runMigrations(db); // works on a brand-new database too
  const repo = new Repo(db);
  const hash = await Bun.password.hash(password); // argon2id

  if (await repo.findAdminByUsername(username)) {
    if (flag !== "--reset") {
      console.error(`admin "${username}" already exists (pass --reset to change the password)`);
      process.exitCode = 1;
    } else {
      await repo.setAdminPassword(username, hash);
      console.log(`password updated for "${username}"`);
    }
  } else {
    await repo.createAdmin(username, hash);
    console.log(`admin "${username}" created`);
  }
} finally {
  await client.close();
}
