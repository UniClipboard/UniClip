import { createServer, request as forward } from "node:http";
import { createServer as createTlsServer } from "node:https";

/**
 * Wrong-but-reachable LAN candidates on host loopback (the emulator reaches them through 10.0.2.2):
 * each answers in one faulty way. They never serve a valid document, so any content the phone
 * applies must have come from the real peer.
 */
const BEHAVIOURS = {
  // Public health answers but every protected request is rejected.
  unauthorized(request, response) {
    if (request.url === "/healthz") return response.writeHead(204).end();
    response.writeHead(401, { "www-authenticate": 'Basic realm="other"' }).end();
  },
  // An older or unrelated HTTP server: no health route, protected path missing.
  notFound(_request, response) {
    response.writeHead(404).end();
  },
  // A captive portal or router page.
  html(_request, response) {
    response.writeHead(200, { "content-type": "text/html" }).end("<html><body>portal</body></html>");
  },
  // A document whose body is cut short.
  truncated(request, response) {
    if (request.url === "/healthz") return response.writeHead(204).end();
    response.writeHead(200, { "content-type": "application/json", "content-length": "400" });
    response.write('{"type":"Text","hash":"TRUNC');
    setTimeout(() => response.destroy(), 50);
  },
};

/**
 * `tls` ({ key, cert }) adds `tlsPutLost`: the same reply-lost proxy behind HTTPS with a
 * throwaway self-signed certificate, sharing its control and connection log.
 */
export function badCandidateServer({ peerPort, tls } = {}) {
  const servers = [];
  const byName = {};
  const putLostLog = [];
  const putLostControl = { drop: "document", fresh: false, keepAliveMs: 5000 };
  const hits = Object.fromEntries(
    [...Object.keys(BEHAVIOURS), "legacyHost", "putResponseLost", "tlsPutLost"].map((k) => [k, 0])
  );
  const tlsHandshakeFailures = [];
  return {
    hits,
    putLostLog,
    putLostControl,
    tlsHandshakeFailures,
    /** Changes the reply-lost proxy's behaviour for the requests that follow. */
    setPutLost(control) {
      Object.assign(putLostControl, control);
      for (const server of [byName.putResponseLost, byName.tlsPutLost]) {
        if (server) server.keepAliveTimeout = putLostControl.keepAliveMs;
      }
    },
    async start() {
      const ports = {};
      const behaviours = { ...BEHAVIOURS };
      if (peerPort) {
        // An older desktop host without the public health route: everything else is the real peer.
        behaviours.legacyHost = (request, response) => {
          if (request.url === "/healthz") return response.writeHead(404).end();
          const upstream = forward(
            { host: "127.0.0.1", port: peerPort, method: request.method, path: request.url, headers: request.headers },
            (reply) => {
              response.writeHead(reply.statusCode, reply.headers);
              reply.pipe(response);
            }
          );
          upstream.on("error", () => response.destroy());
          response.on("close", () => upstream.destroy());
          request.pipe(upstream);
        };
      }
      if (peerPort) {
        // The desktop receives and commits an upload, but the reply never reaches the phone.
        // `control.drop` picks which upload loses its reply ("document", "payload" or "none");
        // `control.fresh` closes every connection after its response so the phone never reuses
        // one; otherwise idle connections are kept for `control.keepAliveMs`.
        behaviours.putResponseLost = (request, response) => {
          const socket = request.socket;
          socket.requestCount = (socket.requestCount ?? 0) + 1;
          const kind =
            request.url === "/SyncClipboard.json"
              ? "document"
              : request.url.startsWith("/file/")
                ? "payload"
                : request.url === "/healthz"
                  ? "health"
                  : request.url.startsWith("/api/sse")
                    ? "sse"
                    : "other";
          // Connection-level facts only: never the credential or the body.
          putLostLog.push({
            at: Date.now(),
            tls: Boolean(socket.encrypted),
            method: request.method,
            kind,
            socket: socket.remotePort,
            requestOnSocket: socket.requestCount,
            userAgent: request.headers["user-agent"] ?? null,
            chunked: /chunked/i.test(request.headers["transfer-encoding"] ?? ""),
            contentLength: request.headers["content-length"] ?? null,
          });
          const drop = request.method === "PUT" && kind === putLostControl.drop;
          const upstream = forward(
            { host: "127.0.0.1", port: peerPort, method: request.method, path: request.url, headers: request.headers },
            (reply) => {
              if (drop) {
                reply.resume();
                reply.on("end", () => response.socket?.destroy());
                return;
              }
              const headers = { ...reply.headers };
              if (putLostControl.fresh && kind !== "sse") headers.connection = "close";
              response.writeHead(reply.statusCode, headers);
              reply.pipe(response);
            }
          );
          upstream.on("error", () => response.destroy());
          response.on("close", () => upstream.destroy());
          request.pipe(upstream);
        };
      }
      if (peerPort && tls) behaviours.tlsPutLost = behaviours.putResponseLost;
      for (const [name, behave] of Object.entries(behaviours)) {
        const handler = (request, response) => {
          hits[name] += 1;
          behave(request, response);
        };
        const server = name === "tlsPutLost" ? createTlsServer(tls, handler) : createServer(handler);
        if (name === "tlsPutLost") {
          // A client that refuses the certificate never sends a request; record the refusal.
          server.on("tlsClientError", (error) => tlsHandshakeFailures.push({ at: Date.now(), code: error.code ?? error.message }));
        }
        await new Promise((done) => server.listen(0, "127.0.0.1", done));
        servers.push(server);
        byName[name] = server;
        if (name === "putResponseLost" || name === "tlsPutLost") server.keepAliveTimeout = putLostControl.keepAliveMs;
        ports[name] = server.address().port;
      }
      return ports;
    },
    async stop() {
      for (const server of servers) {
        server.closeAllConnections?.();
        await new Promise((done) => server.close(done));
      }
    },
  };
}
