import {
  buildServerConfigFromAddServerData,
  getAddServerInitialData,
} from '@/screens/settings/serverFormAdapter';
import type { ServerConfig } from '@/types/api';

describe('settings server form adapter', () => {
  it('prefills the unified server sheet with all saved addresses', () => {
    const config: ServerConfig = {
      type: 'syncclipboard',
      name: 'Home server',
      url: 'https://wan.example.com',
      urls: ['https://lan.example.com', 'https://wan.example.com'],
      username: 'mark',
      password: 'secret',
    };

    expect(getAddServerInitialData(config)).toEqual({
      name: 'Home server',
      urls: ['https://lan.example.com', 'https://wan.example.com'],
      username: 'mark',
      password: 'secret',
    });
  });

  it('uses the primary url when editing a server without a saved urls list', () => {
    const config: ServerConfig = {
      type: 'syncclipboard',
      url: 'https://only.example.com',
      username: 'mark',
      password: 'secret',
    };

    expect(getAddServerInitialData(config).urls).toEqual(['https://only.example.com']);
  });

  it('preserves existing server-specific fields when saving an edit', () => {
    const existing: ServerConfig = {
      type: 's3',
      name: 'Bucket',
      url: 'https://s3.example.com',
      username: 'old-key',
      password: 'old-secret',
      region: 'ap-east-1',
      bucketName: 'uniclipboard',
      objectPrefix: 'prod/',
      forcePathStyle: true,
    };

    expect(
      buildServerConfigFromAddServerData(
        {
          name: 'Updated bucket',
          urls: ['https://primary.example.com', 'https://backup.example.com'],
          username: 'new-key',
          password: 'new-secret',
        },
        existing
      )
    ).toEqual({
      ...existing,
      name: 'Updated bucket',
      url: 'https://primary.example.com',
      urls: ['https://primary.example.com', 'https://backup.example.com'],
      username: 'new-key',
      password: 'new-secret',
    });
  });
});
