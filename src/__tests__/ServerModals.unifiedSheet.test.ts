import fs from 'fs';
import path from 'path';

describe('settings server modals', () => {
  it('opens the unified add/edit server sheet instead of the legacy server config modal', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../screens/settings/ServerModals.tsx'),
      'utf8'
    );

    expect(source).toContain('AddServerSheet');
    expect(source).not.toContain('ServerConfigModal');
  });
});
