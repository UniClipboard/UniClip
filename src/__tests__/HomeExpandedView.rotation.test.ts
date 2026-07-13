import fs from 'fs';
import path from 'path';

describe('HomeExpandedView rotation layout', () => {
  it('keeps one master grid while detail changes between side and overlay', () => {
    const source = fs.readFileSync(path.join(__dirname, '../screens/HomeExpandedView.tsx'), 'utf8');

    expect(source.match(/<HomeMasterGrid/g)).toHaveLength(1);
    expect(source).toContain('computeExpandedWorkspaceLayout(screenWidth)');
    expect(source).toContain('paneWidth={workspace.gridWidth}');
    expect(source).toContain("workspace.detailPlacement === 'side'");
    expect(source).toContain('onSelectItem={handleSelectItem}');
    expect(source).toContain('{ width: workspace.gridWidth }');
    expect(source).toContain('styles.overlayDetail');
    expect(source).not.toContain('styles.sideDetail');
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
});
