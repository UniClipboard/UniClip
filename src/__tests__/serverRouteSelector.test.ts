import { AuthenticationError, NetworkError, ServerError, TimeoutError } from '@/services/errors';
import {
  NetworkContext,
  createRoutedOperation,
  orderServerUrls,
  selectServerUrl,
} from '@/services/serverRouteSelector';
import type { ServerConfig } from '@/types/api';

function server(urls: string[]): ServerConfig {
  return {
    type: 'syncclipboard',
    url: urls[0],
    urls,
    username: 'alice',
    password: 'secret',
  };
}

describe('serverRouteSelector', () => {
  const lan = 'http://192.168.1.20:5033';
  const tailnet = 'http://clip.tail123.ts.net:5033';
  const wan = 'https://clip.example.com';

  it('orders one server profile for the current network and remembered live url', () => {
    const config = server([wan, lan, tailnet]);

    expect(orderServerUrls(config, { isWifi: true, isCellular: false, isTailscale: false })).toEqual([
      lan,
      tailnet,
      wan,
    ]);

    expect(
      orderServerUrls(config, { isWifi: false, isCellular: true, isTailscale: false })
    ).toEqual([wan, tailnet, lan]);

    expect(
      orderServerUrls(
        config,
        { isWifi: true, isCellular: false, isTailscale: false },
        { liveUrl: wan }
      )
    ).toEqual([lan, tailnet, wan]);
  });

  it('keeps a remembered live url first when it still matches the best network class', () => {
    const sameClassWan = 'https://backup.example.com';
    const config = server([wan, sameClassWan, lan]);

    expect(
      orderServerUrls(
        config,
        { isWifi: false, isCellular: true, isTailscale: false },
        { liveUrl: sameClassWan }
      )
    ).toEqual([sameClassWan, wan, lan]);
  });

  it('ignores a remembered live url from a lower-priority network class', () => {
    const config = server([wan, lan, tailnet]);

    expect(
      orderServerUrls(
        config,
        { isWifi: false, isCellular: true, isTailscale: true },
        { liveUrl: lan }
      )
    ).toEqual([tailnet, wan, lan]);
  });

  it('falls through unreachable routes, returns the first success, and records it', async () => {
    const config = server([lan, wan]);
    const liveUrls = new Map<string, string>();
    const attempts: string[] = [];

    const result = await selectServerUrl(
      config,
      {
        network: { isWifi: true, isCellular: false, isTailscale: false },
        loadLiveUrl: () => liveUrls.get('http://192.168.1.20:5033') ?? null,
        saveLiveUrl: (_key, url) => {
          if (url) liveUrls.set('http://192.168.1.20:5033', url);
        },
      },
      async (route) => {
        attempts.push(route.url);
        if (route.url === lan) throw new TimeoutError('timed out');
        return 'ok';
      }
    );

    expect(result).toEqual({ result: 'ok', url: wan, attempts: [lan, wan] });
    expect(attempts).toEqual([lan, wan]);
    expect(liveUrls.get('http://192.168.1.20:5033')).toBe(wan);
  });

  it('probes candidate routes concurrently and sends through the fastest healthy route once', async () => {
    const config = server([lan, wan, tailnet]);
    const probes: string[] = [];
    const sends: string[] = [];

    const result = await selectServerUrl(
      config,
      {
        network: { isWifi: false, isCellular: true, isTailscale: true },
        loadLiveUrl: () => null,
        saveLiveUrl: () => {},
        probeTimeoutMs: 30,
        probeRoute: async (route, signal) => {
          probes.push(route.url);
          if (route.url === lan) {
            return new Promise((_, reject) => {
              signal?.addEventListener('abort', () => reject(new NetworkError('probe aborted')), {
                once: true,
              });
            });
          }
          if (route.url === wan) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        },
      },
      async (route) => {
        sends.push(route.url);
        return 'ok';
      }
    );

    expect(result).toEqual({ result: 'ok', url: tailnet, attempts: [tailnet] });
    expect(probes).toEqual(expect.arrayContaining([tailnet, wan, lan]));
    expect(sends).toEqual([tailnet]);
  });

  it('does not send through routes that failed the probe', async () => {
    const config = server([lan, wan, tailnet]);
    const sends: string[] = [];

    await expect(
      selectServerUrl(
        config,
        {
          network: { isWifi: false, isCellular: true, isTailscale: true },
          loadLiveUrl: () => null,
          saveLiveUrl: () => {},
          probeTimeoutMs: 30,
          probeRoute: async (route, signal) => {
            if (route.url === lan) {
              return new Promise((_, reject) => {
                signal?.addEventListener('abort', () => reject(new NetworkError('probe aborted')), {
                  once: true,
                });
              });
            }
            if (route.url === tailnet) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            if (route.url === wan) {
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          },
        },
        async (route) => {
          sends.push(route.url);
          if (route.url === tailnet) throw new NetworkError('upload failed');
          return 'ok';
        }
      )
    ).resolves.toEqual({ result: 'ok', url: wan, attempts: [tailnet, wan] });

    expect(sends).toEqual([tailnet, wan]);
    expect(sends).not.toContain(lan);
  });

  it('fails fast when every candidate route fails the probe', async () => {
    const sends: string[] = [];
    const saved: (string | null)[] = [];

    await expect(
      selectServerUrl(
        server([lan, wan]),
        {
          network: { isWifi: false, isCellular: true, isTailscale: true },
          loadLiveUrl: () => null,
          saveLiveUrl: (_key, url) => {
            saved.push(url);
          },
          probeTimeoutMs: 10,
          probeRoute: async () => {
            throw new NetworkError('offline');
          },
        },
        async (route) => {
          sends.push(route.url);
          return 'ok';
        }
      )
    ).rejects.toBeInstanceOf(NetworkError);

    expect(sends).toEqual([]);
    expect(saved).toEqual([null]);
  });

  it('stops immediately on authentication failures', async () => {
    const attempts: string[] = [];

    await expect(
      selectServerUrl(
        server([lan, wan]),
        {
          network: { isWifi: true, isCellular: false, isTailscale: false },
          loadLiveUrl: () => null,
          saveLiveUrl: () => {},
        },
        async (route) => {
          attempts.push(route.url);
          throw new AuthenticationError('bad password');
        }
      )
    ).rejects.toBeInstanceOf(AuthenticationError);

    expect(attempts).toEqual([lan]);
  });

  it('reuses routing for object method calls without changing the call shape', async () => {
    class ClipboardClient {
      constructor(private readonly url: string) {}
      async putClipboard(profile: { text: string }) {
        if (this.url === lan) throw new NetworkError('offline');
        return `${this.url}:${profile.text}`;
      }
    }

    const routed = createRoutedOperation(
      server([lan, wan]),
      {
        network: { isWifi: true, isCellular: false, isTailscale: false },
        loadLiveUrl: () => null,
        saveLiveUrl: () => {},
      },
      (route) => new ClipboardClient(route.url)
    );

    await expect(routed.call('putClipboard', { text: 'hello' })).resolves.toBe(`${wan}:hello`);
  });

  it('keeps publisher order when the network has no useful signal', () => {
    const network: NetworkContext = {
      isWifi: false,
      isCellular: false,
      isTailscale: false,
    };

    expect(orderServerUrls(server([wan, lan, tailnet]), network)).toEqual([wan, lan, tailnet]);
  });

  it('does not retry server-side request errors', async () => {
    const attempts: string[] = [];

    await expect(
      selectServerUrl(
        server([lan, wan]),
        {
          network: { isWifi: true, isCellular: false, isTailscale: false },
          loadLiveUrl: () => null,
          saveLiveUrl: () => {},
        },
        async (route) => {
          attempts.push(route.url);
          throw new ServerError('bad request', 400);
        }
      )
    ).rejects.toBeInstanceOf(ServerError);

    expect(attempts).toEqual([lan]);
  });
});
