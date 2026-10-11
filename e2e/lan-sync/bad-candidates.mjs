import { createServer, request as forward } from "node:http";

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

export function badCandidateServer({ peerPort } = {}) {
  const servers = [];
  const hits = Object.fromEntries([...Object.keys(BEHAVIOURS), "legacyHost"].map((k) => [k, 0]));
  return {
    hits,
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
      for (const [name, behave] of Object.entries(behaviours)) {
        const server = createServer((request, response) => {
          hits[name] += 1;
          behave(request, response);
        });
        await new Promise((done) => server.listen(0, "127.0.0.1", done));
        servers.push(server);
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
