export interface LanInsecureHttpTransport {
  getJson(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<{ status: number; data?: unknown }>;
  putJson(
    url: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<{ status: number; data?: unknown }>;
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
}

const REQUEST_TIMEOUT_MS = 5000;

async function blobUtil() {
  return (await import('react-native-blob-util')).default;
}

function nativePath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  return decodeURIComponent(uri.slice('file://'.length));
}

export class ReactNativeBlobLanTransport implements LanInsecureHttpTransport {
  async getJson(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<{ status: number; data?: unknown }> {
    const transport = await blobUtil();
    if (signal?.aborted) throw new Error('LAN request was cancelled');
    const task = transport
      .config({ trusty: true, timeout: REQUEST_TIMEOUT_MS })
      .fetch('GET', url, headers);
    // Cancelling the native task stops the request itself, not only the JS promise waiting for it.
    const cancel = () => {
      task.cancel(() => undefined);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    let response: Awaited<typeof task>;
    try {
      response = await task;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    const status = response.info().status;
    const text = await response.text();
    if (!text) return { status };
    try {
      return { status, data: JSON.parse(text) };
    } catch {
      return { status };
    }
  }

  async putJson(
    url: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<{ status: number; data?: unknown }> {
    const transport = await blobUtil();
    const response = await transport
      .config({ trusty: true, timeout: REQUEST_TIMEOUT_MS })
      .fetch('PUT', url, { ...headers, 'content-type': 'application/json' }, JSON.stringify(body));
    let data: unknown;
    try {
      data = JSON.parse(response.data);
    } catch {
      data = undefined;
    }
    return { status: response.info().status, data };
  }

  async uploadFile(
    sourceUri: string,
    url: string,
    headers: Record<string, string>
  ): Promise<{ status: number }> {
    const transport = await blobUtil();
    const response = await transport
      .config({ trusty: true, timeout: REQUEST_TIMEOUT_MS })
      .fetch('PUT', url, headers, transport.wrap(nativePath(sourceUri)));
    return { status: response.info().status };
  }

  async downloadFile(
    url: string,
    destinationUri: string,
    headers: Record<string, string>
  ): Promise<string> {
    const transport = await blobUtil();
    const destinationPath = nativePath(destinationUri);
    const response = await transport
      .config({
        trusty: true,
        timeout: REQUEST_TIMEOUT_MS,
        path: destinationPath,
        overwrite: true,
      })
      .fetch('GET', url, headers);
    const status = response.info().status;
    if (status < 200 || status >= 300) {
      await transport.fs.unlink(destinationPath).catch(() => undefined);
      throw new Error(`LAN payload download failed with status ${status}`);
    }
    return destinationUri;
  }
}
