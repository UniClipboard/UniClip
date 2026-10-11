import { Buffer } from 'node:buffer';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

function loadClient():
  | {
      LanHttpClient: new (dependencies?: {
        uploadFile?: (
          sourceUri: string,
          url: string,
          headers: Record<string, string>
        ) => Promise<{ status: number }>;
        downloadFile?: (
          url: string,
          destinationUri: string,
          headers: Record<string, string>
        ) => Promise<string>;
        insecureTransport?: {
          getJson(
            url: string,
            headers: Record<string, string>
          ): Promise<{ status: number; data?: unknown }>;
          putJson(
            url: string,
            body: unknown,
            headers: Record<string, string>
          ): Promise<{ status: number }>;
          uploadFile(
            sourceUri: string,
            url: string,
            headers: Record<string, string>
          ): Promise<{ status: number }>;
          downloadFile(
            url: string,
            destinationUri: string,
            headers: Record<string, string>
          ): Promise<string>;
        };
        fetchStream?: typeof globalThis.fetch;
      }) => {
        getClipboard(server: unknown): Promise<{ document: unknown; url: string } | null>;
        putClipboard(
          server: unknown,
          document: unknown,
          payload?: { uri: string; name: string }
        ): Promise<{ url: string }>;
        downloadPayload(
          server: unknown,
          baseUrl: string,
          name: string,
          destinationUri: string
        ): Promise<string>;
        subscribeClipboardEvents(
          server: unknown,
          listener: {
            onEvent(event: unknown): void;
            onDisconnected(error: Error): void;
          }
        ): () => void;
      };
    }
  | undefined {
  try {
    return require('../features/lan-sync/internal/lanHttpClient');
  } catch {
    return undefined;
  }
}

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

async function fixtureServer() {
  const requests: Array<{
    method?: string;
    url?: string;
    authorization?: string;
    body: string;
  }> = [];
  const expectedAuth = `Basic ${Buffer.from('mobile:secret').toString('base64')}`;
  const document = {
    type: 'Text',
    hash: 'ABC123',
    contentId: 'blake3v1:server-text',
    text: 'from desktop',
    hasData: false,
    size: 12,
  };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      if (request.url?.startsWith('/broken/')) {
        response.writeHead(500).end();
        return;
      }
      if (request.headers.authorization !== expectedAuth) {
        response.writeHead(401).end();
        return;
      }
      if (request.url?.endsWith('/api/sse/clipboard')) {
        response.writeHead(200, {
          connection: 'close',
          'content-type': 'text/event-stream',
        });
        response.write('event: hello\ndata: {"server_time_ms":42}\n\n');
        response.write(': ping\n\n');
        response.write('event: update\ndata: {"content_id":"blake3v1:next",');
        response.write('"server_time_ms":43}\n\n');
        response.write('event: ignored\ndata: {}\n\n');
        response.end('event: resync\ndata: {"server_time_ms":44}\n\n');
        return;
      }
      if (request.method === 'GET') {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(document));
        return;
      }
      response.writeHead(204).end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing fixture address');
  return { base: `http://127.0.0.1:${address.port}`, requests, document };
}

describe('LanHttpClient', () => {
  it('tries candidates in order and reads the authenticated clipboard document', async () => {
    const module = loadClient();
    expect(module).toBeDefined();
    if (!module) return;
    const fixture = await fixtureServer();
    const client = new module.LanHttpClient();
    const server = {
      urls: [`${fixture.base}/broken`, `${fixture.base}/ok`],
      username: 'mobile',
      password: 'secret',
      allowInsecureTls: false,
    };

    await expect(client.getClipboard(server)).resolves.toEqual({
      document: fixture.document,
      url: `${fixture.base}/ok`,
    });
    // Public health probes run in parallel and carry no credentials; protected reads follow.
    const protectedReads = fixture.requests.filter((r) => r.url?.endsWith('/SyncClipboard.json'));
    expect(protectedReads.map((request) => request.url).sort()).toEqual([
      '/broken/SyncClipboard.json',
      '/ok/SyncClipboard.json',
    ]);
    expect(protectedReads.find((r) => r.url === '/ok/SyncClipboard.json')?.authorization).toMatch(
      /^Basic /
    );
    expect(
      fixture.requests.filter((r) => r.url?.endsWith('/healthz')).every((r) => !r.authorization)
    ).toBe(true);
  });

  it('uploads the exact text document with Basic Auth', async () => {
    const module = loadClient();
    expect(module).toBeDefined();
    if (!module) return;
    const fixture = await fixtureServer();
    const client = new module.LanHttpClient();
    const server = {
      urls: [`${fixture.base}/ok`],
      username: 'mobile',
      password: 'secret',
      allowInsecureTls: false,
    };
    const document = {
      type: 'Text',
      hash: 'LOCAL_HASH',
      text: 'from phone',
      hasData: false,
      size: 10,
    };

    await expect(client.putClipboard(server, document)).resolves.toEqual({
      url: `${fixture.base}/ok`,
    });
    // The write goes to the address verified by route discovery, once.
    const writes = fixture.requests.filter((request) => request.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      method: 'PUT',
      url: '/ok/SyncClipboard.json',
      authorization: expect.stringMatching(/^Basic /),
      body: JSON.stringify(document),
    });
  });

  it('uploads the payload before publishing its metadata', async () => {
    const module = loadClient();
    expect(module).toBeDefined();
    if (!module) return;
    const fixture = await fixtureServer();
    const uploadFile = jest.fn(async (_sourceUri: string, url: string, headers: object) => {
      expect(fixture.requests.filter((request) => request.method === 'PUT')).toHaveLength(0);
      expect(url).toBe(`${fixture.base}/ok/file/image.png`);
      expect(headers).toEqual({
        authorization: expect.stringMatching(/^Basic /),
        'content-type': 'application/octet-stream',
      });
      return { status: 204 };
    });
    const client = new module.LanHttpClient({ uploadFile });
    const server = {
      urls: [`${fixture.base}/ok`],
      username: 'mobile',
      password: 'secret',
      allowInsecureTls: false,
    };
    const document = {
      type: 'Image',
      hash: 'IMAGE_HASH',
      text: 'image.png',
      hasData: true,
      dataName: 'image.png',
      size: 1000,
    };

    await client.putClipboard(server, document, {
      uri: 'file:///cache/image.png',
      name: 'image.png',
    });

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const writes = fixture.requests.filter((request) => request.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(
      expect.objectContaining({
        method: 'PUT',
        url: '/ok/SyncClipboard.json',
        body: JSON.stringify(document),
      })
    );
  });

  it('downloads an authenticated payload to the requested local file', async () => {
    const module = loadClient();
    expect(module).toBeDefined();
    if (!module) return;
    const downloadFile = jest.fn(async () => 'file:///cache/REMOTE_HASH-report.pdf');
    const client = new module.LanHttpClient({ downloadFile });
    const server = {
      urls: ['http://desk.local:42720'],
      username: 'mobile',
      password: 'secret',
      allowInsecureTls: false,
    };

    await expect(
      client.downloadPayload(
        server,
        server.urls[0],
        'report 2026.pdf',
        'file:///cache/REMOTE_HASH-report.pdf'
      )
    ).resolves.toBe('file:///cache/REMOTE_HASH-report.pdf');
    expect(downloadFile).toHaveBeenCalledWith(
      'http://desk.local:42720/file/report%202026.pdf',
      'file:///cache/REMOTE_HASH-report.pdf',
      { authorization: expect.stringMatching(/^Basic /) }
    );
  });

  it('rejects unsafe remote payload names before making a request', async () => {
    const module = loadClient();
    expect(module).toBeDefined();
    if (!module) return;
    const downloadFile = jest.fn(async () => 'file:///cache/secret');
    const client = new module.LanHttpClient({ downloadFile });
    const server = {
      urls: ['http://desk.local:42720'],
      username: 'mobile',
      password: 'secret',
      allowInsecureTls: false,
    };

    await expect(
      client.downloadPayload(server, server.urls[0], '../secret', 'file:///cache/secret')
    ).rejects.toThrow('Invalid LAN payload name');
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('uses the trusted opt-in transport for every self-signed HTTPS operation', async () => {
    const module = loadClient();
    expect(module).toBeDefined();
    if (!module) return;
    const document = {
      type: 'Image',
      hash: 'IMAGE_HASH',
      text: 'image.png',
      hasData: true,
      dataName: 'image.png',
      size: 1000,
    };
    const insecureTransport = {
      getJson: jest.fn(async () => ({ status: 200, data: document })),
      putJson: jest.fn(async () => ({ status: 204 })),
      uploadFile: jest.fn(async () => ({ status: 204 })),
      downloadFile: jest.fn(async () => 'file:///cache/image.png'),
    };
    const client = new module.LanHttpClient({ insecureTransport });
    const server = {
      urls: ['https://self-signed.local:42720'],
      username: 'mobile',
      password: 'secret',
      allowInsecureTls: true,
    };

    await expect(client.getClipboard(server)).resolves.toEqual({
      document,
      url: server.urls[0],
    });
    await client.putClipboard(server, document, {
      uri: 'file:///cache/image.png',
      name: 'image.png',
    });
    await expect(
      client.downloadPayload(server, server.urls[0], 'image.png', 'file:///cache/image.png')
    ).resolves.toBe('file:///cache/image.png');

    const auth = { authorization: expect.stringMatching(/^Basic /) };
    // The health probe and the protected read both use the trusted transport; only the read is
    // authenticated, and both can be cancelled through the passed signal.
    expect(insecureTransport.getJson).toHaveBeenCalledWith(
      'https://self-signed.local:42720/healthz',
      {},
      expect.any(AbortSignal)
    );
    expect(insecureTransport.getJson).toHaveBeenCalledWith(
      'https://self-signed.local:42720/SyncClipboard.json',
      auth,
      expect.any(AbortSignal)
    );
    expect(insecureTransport.uploadFile).toHaveBeenCalledWith(
      'file:///cache/image.png',
      'https://self-signed.local:42720/file/image.png',
      { ...auth, 'content-type': 'application/octet-stream' }
    );
    expect(insecureTransport.putJson).toHaveBeenCalledWith(
      'https://self-signed.local:42720/SyncClipboard.json',
      document,
      auth
    );
    expect(insecureTransport.downloadFile).toHaveBeenCalledWith(
      'https://self-signed.local:42720/file/image.png',
      'file:///cache/image.png',
      auth
    );
  });

  it('streams authenticated SSE events from the first reachable candidate', async () => {
    const module = loadClient();
    expect(module).toBeDefined();
    if (!module) return;
    const fixture = await fixtureServer();
    const client = new module.LanHttpClient({ fetchStream: globalThis.fetch });
    const server = {
      urls: [`${fixture.base}/broken`, `${fixture.base}/ok`],
      username: 'mobile',
      password: 'secret',
      allowInsecureTls: false,
    };
    const events: unknown[] = [];
    const disconnected = new Promise<Error>((resolve) => {
      client.subscribeClipboardEvents(server, {
        onEvent: (event) => events.push(event),
        onDisconnected: resolve,
      });
    });

    await expect(disconnected).resolves.toEqual(expect.any(Error));
    // The subscription uses the route verified by discovery instead of trying candidates in turn.
    const streams = fixture.requests.filter((r) => r.url?.endsWith('/api/sse/clipboard'));
    expect(streams.map((request) => request.url)).toEqual(['/ok/api/sse/clipboard']);
    expect(streams[0].authorization).toMatch(/^Basic /);
    expect(events).toEqual([
      { type: 'hello', serverTimeMs: 42 },
      { type: 'update', contentId: 'blake3v1:next', serverTimeMs: 43 },
      { type: 'resync', serverTimeMs: 44 },
    ]);
  });

  it('cancels an SSE request without reporting a disconnect', async () => {
    const module = loadClient();
    expect(module).toBeDefined();
    if (!module) return;
    let signal: AbortSignal | undefined;
    const fetchStream = jest.fn(
      async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        signal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError'))
          );
        });
      }
    );
    const onDisconnected = jest.fn();
    const client = new module.LanHttpClient({ fetchStream });
    const cancel = client.subscribeClipboardEvents(
      {
        urls: ['http://desk.local:42720'],
        username: 'mobile',
        password: 'secret',
        allowInsecureTls: false,
      },
      { onEvent: jest.fn(), onDisconnected }
    );

    await Promise.resolve();
    cancel();
    await Promise.resolve();

    // Cancelling before or during the stream request leaves no request running.
    expect(fetchStream.mock.calls.length === 0 || signal?.aborted === true).toBe(true);
    expect(onDisconnected).not.toHaveBeenCalled();
  });
});
