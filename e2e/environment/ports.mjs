import { createServer } from "node:net";
import { randomInt } from "node:crypto";

const used = new Set();
const start = randomInt(0, 15);
async function available(port) {
  const server = createServer();
  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
/** Keep transport serials unique for the entire run, not just concurrently live devices. */
export async function reserveEmulatorPort() {
  for (let i = 0; i < 15; i++) {
    const port = 5556 + 2 * ((start + i) % 15);
    if (used.has(port)) continue;
    used.add(port);
    if ((await available(port)) && (await available(port + 1))) return port;
  }
  throw new Error("No unused emulator transport port pair is available");
}
