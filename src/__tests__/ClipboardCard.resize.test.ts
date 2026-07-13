import fs from 'fs';
import path from 'path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('ClipboardCard resize behavior', () => {
  it.each(['components/ClipboardCard.android.tsx', 'components/ClipboardCard.ios.tsx'])(
    '%s lets native layout resize decorative fills without local state',
    (relativePath) => {
      const source = read(relativePath);

      expect(source).not.toContain('const [size, setSize]');
      expect(source).toContain('<Svg style={StyleSheet.absoluteFill}');
    }
  );
});
