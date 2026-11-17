import { loadConfig } from "./src/config";
import { createServer } from "./src/server";

const config = loadConfig();
const server = await createServer(config);
console.log(`🦊 Y-Space API on :${server.port}  (frontend: ${config.publicWebUrl})`);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${sig} received, shutting down`);
    await server.stop();
    process.exit(0);
  });
}
