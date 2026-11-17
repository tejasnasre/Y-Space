import { cors } from "@elysiajs/cors";
import { Server as Engine } from "@socket.io/bun-engine";
import { Elysia } from "elysia";
import { Server as IoServer } from "socket.io";
import type { Config } from "./config";
import { createDb, runMigrations } from "./db";
import { createHttpRoutes } from "./http/routes";
import { AppError } from "./lib/errors";
import { createSocketNotifier, registerSocketHandlers } from "./realtime/hub";
import { Repo } from "./repo";
import { Scheduler } from "./services/scheduler";
import { createSpeakQueue } from "./services/speak-queue";
import { AdminAuth } from "./services/admin-auth";
import { SpaceManager } from "./services/space-manager";
import { Media } from "./sfu/media";

export async function createServer(config: Config) {
  const { db, client } = createDb(config.databaseUrl);
  await runMigrations(db);
  const repo = new Repo(db);
  const media = await Media.create(config.rtc);

  const io = new IoServer();
  const engine = new Engine({
    path: "/socket.io/",
    maxHttpBufferSize: 64 * 1024, // signaling messages are a few KB
    cors: { origin: config.corsOrigins === true ? "*" : config.corsOrigins },
  });
  io.bind(engine);

  const auth = new AdminAuth(repo, config);
  const speakQueue = await createSpeakQueue(client, config.speakQueue);
  const manager = new SpaceManager(repo, media, config, (spaceId) => createSocketNotifier(io, spaceId), speakQueue);
  await manager.recoverFromRestart();
  registerSocketHandlers(io, manager, auth);
  const scheduler = new Scheduler(client, manager, config);
  await scheduler.start();

  const app = new Elysia()
    .onError({ as: "global" }, ({ error, code, set }) => {
      if (error instanceof AppError) {
        set.status = error.status;
        return { error: error.code, message: error.message };
      }
      if (code === "PARSE") {
        set.status = 400;
        return { error: "invalid_json", message: "request body is not valid JSON" };
      }
      if (code === "VALIDATION") {
        set.status = 422;
        return { error: "validation_error", message: "invalid request body or parameters" };
      }
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "not_found" };
      }
      console.error("[http] unhandled", error);
      set.status = 500;
      return { error: "internal_error" };
    })
    // CORS for the REST API only; socket.io (engine) answers its own CORS
    .use(cors({ origin: config.corsOrigins === true ? true : config.corsOrigins }))
    .get("/health", () => ({ ok: true, live: manager.room?.spaceId ?? null, scheduler: scheduler.mode, queue: speakQueue.kind }))
    .use(createHttpRoutes({ config, repo, auth, manager }))
    .all("/socket.io/", ({ request, server }) => engine.handleRequest(request, server as never));

  // engine.handler() also sets maxRequestBodySize = maxHttpBufferSize (64 KB): big bodies are refused
  // by Bun before they are buffered or parsed
  app.listen({ port: config.port, ...engine.handler() });

  return {
    app,
    repo,
    manager,
    scheduler,
    speakQueue,
    /** the raw Postgres client, for tests that need NOTIFY or raw SQL */
    sql: client,
    /** actual port (useful when config.port is 0) */
    get port(): number {
      return app.server!.port as number;
    },
    async stop() {
      await scheduler.stop();
      if (manager.room) await manager.endSpace(manager.room.spaceId, "server_shutdown");
      await io.close();
      await app.stop(true);
      media.close();
      await client.close();
    },
  };
}
