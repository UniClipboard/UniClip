import fs from 'fs';
import path from 'path';

describe('HomeExpandedView rotation layout', () => {
  it('keeps one master grid while portrait detail uses a modal page', () => {
    const source = fs.readFileSync(path.join(__dirname, '../screens/HomeExpandedView.tsx'), 'utf8');

    expect(source.match(/<HomeMasterGrid/g)).toHaveLength(1);
    expect(source).toContain('computeExpandedWorkspaceLayout(screenWidth)');
    expect(source).toContain('paneWidth={workspace.gridWidth}');
    expect(source).toContain("workspace.detailPlacement === 'side'");
    expect(source).toContain('onSelectItem={handleSelectItem}');
    expect(source).toContain('{ width: workspace.gridWidth }');
    expect(source).toContain('<ClipboardDetailModal');
    expect(source).toContain('visible={!showSideDetail && detailActivated}');
    expect(source).toContain('{showSideDetail && (');
    expect(source).not.toContain('styles.overlayDetail');
    expect(source).not.toContain('useWindowDimensions');
    expect(source).toContain('screenWidth: number');
    expect(source).toContain('item={detailActivated ? c.detailItem : null}');

    for (const platform of ['android', 'ios']) {
      const dispatcher = fs.readFileSync(
        path.join(__dirname, `../screens/HomeView.${platform}.tsx`),
        'utf8'
      );
      expect(dispatcher).toContain('screenWidth={screenWidth}');
    }

    for (const sharedScreen of ['HomeCompactView.tsx', 'HomeMasterGrid.tsx']) {
      const sharedSource = fs.readFileSync(
        path.join(__dirname, `../screens/${sharedScreen}`),
        'utf8'
      );
      expect(sharedSource).not.toContain('Platform.OS');
    }
  });

  it('uses platform-specific native detail presentations', () => {
    const files = [
      'components/ClipboardDetailModal.tsx',
      'components/ClipboardDetailModal.types.ts',
      'components/ClipboardDetailModal.android.tsx',
      'components/ClipboardDetailModal.ios.tsx',
    ];

    for (const relativePath of files) {
      expect(fs.existsSync(path.join(__dirname, '..', relativePath))).toBe(true);
    }

    if (files.some((relativePath) => !fs.existsSync(path.join(__dirname, '..', relativePath)))) {
      return;
    }

    const base = fs.readFileSync(
      path.join(__dirname, '../components/ClipboardDetailModal.tsx'),
      'utf8'
    );
    const android = fs.readFileSync(
      path.join(__dirname, '../components/ClipboardDetailModal.android.tsx'),
      'utf8'
    );
    const ios = fs.readFileSync(
      path.join(__dirname, '../components/ClipboardDetailModal.ios.tsx'),
      'utf8'
    );

    expect(base).toContain("export * from './ClipboardDetailModal.android'");
    expect(android).toContain('<Modal');
    expect(android).toContain('transparent');
    expect(android).toContain('styles.dialog');
    expect(android).toContain('onRequestClose={onDismiss}');
    expect(ios).toContain('presentationStyle="pageSheet"');
    expect(ios).toContain('onRequestClose={onDismiss}');
  });
});
