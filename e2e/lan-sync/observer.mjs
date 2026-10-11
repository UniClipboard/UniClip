import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { contentAlias } from "./timeline.mjs";

/**
 * Host-side observer of the peer's LAN listener, using its own device credential so it never
 * evicts the phone's stream. Records each `update` (desktop content id and activation time) and
 * reads the current document to bind a fixture nonce to its content id. Never writes.
 */
export function lanObserver({ port, credential, output }) {
  const base = `http://127.0.0.1:${port}`;
  const authorization = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`;
  const updates = [];
  let controller = null;
  let reading = null;

  async function read() {
    const response = await fetch(`${base}/api/sse/clipboard`, {
      headers: { authorization, accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Observer SSE failed: ${response.status}`);
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = block.match(/^event: (.*)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (event === "update" && data) {
          const parsed = JSON.parse(data);
          updates.push({ contentId: parsed.content_id, serverTimeMs: parsed.server_time_ms, hostReceivedMs: Date.now() });
        }
      }
    }
  }

  return {
    updates,
    async start() {
      controller = new AbortController();
      reading = read().catch(() => {});
      await delay(500);
    },
    async stop() {
      controller?.abort();
      await reading;
      await writeFile(
        join(output, "observer-updates.json"),
        JSON.stringify(updates.map(({ contentId, ...u }) => ({ alias: contentAlias(contentId), ...u })), null, 2)
      );
    },
    async currentDocument() {
      const response = await fetch(`${base}/SyncClipboard.json`, { headers: { authorization } });
      if (!response.ok) throw new Error(`Observer GET failed: ${response.status}`);
      return response.json();
    },
    async waitForUpdate(contentId, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = updates.find((u) => u.contentId === contentId);
        if (found) return found;
        await delay(50);
      }
      return null;
    },
  };
}
