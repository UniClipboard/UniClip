import fs from 'fs';
import path from 'path';

describe('iOS settings server list', () => {
  const source = fs.readFileSync(path.join(__dirname, '../screens/SettingsScreen.ios.tsx'), 'utf8');

  it('opens a dedicated server list screen from the server row', () => {
    expect(source).toContain('showServerList');
    expect(source).toContain('setShowServerList(true)');
    expect(source).toContain('服务器列表');
    expect(source).toContain('onTapGesture');
  });

  it('uses the unified server sheet for adding and editing servers', () => {
    expect(source).toContain('AddServerSheet');
    expect(source).toContain('editingServerIndex');
    expect(source).toContain('updateServer');
    expect(source).toContain('addServer');
  });

  it('uses icon-only current server state and shows address count with url', () => {
    expect(source).toContain("systemImage={isActive ? 'checkmark.circle.fill' : 'server.rack'}");
    expect(source).toContain('getServerAddressCount');
    expect(source).toContain('getServerPrimaryUrl');
    expect(source).not.toContain('当前使用');
  });

  it('nests the add/edit sheet inside the settings sheet on iOS', () => {
    expect(source.indexOf('<AddServerSheet')).toBeGreaterThan(source.indexOf('<BottomSheet'));
    expect(source.indexOf('<AddServerSheet')).toBeLessThan(source.indexOf('</BottomSheet>'));
    expect(source).toContain('embeddedInHost');
  });

  it('does not add another Host into the settings sheet layout', () => {
    const sheetSource = fs.readFileSync(
      path.join(__dirname, '../components/AddServerSheet.ios.tsx'),
      'utf8'
    );

    expect(sheetSource).toContain('embeddedInHost = false');
    expect(sheetSource).toContain('return embeddedInHost ? (');
  });

  it('uses the same grouped background behind the server list header and body', () => {
    const sheetPageSource = fs.readFileSync(
      path.join(__dirname, '../components/ui/IosSheetPage.ios.tsx'),
      'utf8'
    );

    expect(source).toContain('IosSheetPage');
    expect(source).toContain('IosSheetForm');
    expect(sheetPageSource).toContain('iosColors?.systemGroupedBackground');
    expect(sheetPageSource).toContain('background(sheetPageBackgroundColor)');
  });

  it('uses the shared left and right header button slots for the server list', () => {
    const serverListStart = source.indexOf('title="服务器列表"');
    const serverListEnd = source.indexOf('<IosSheetForm>', serverListStart);
    const serverListHeader = source.slice(serverListStart, serverListEnd);

    expect(serverListHeader).toContain('leftSlots={[');
    expect(serverListHeader).toContain('rightSlots={[');
    expect(serverListHeader).toContain("buttonStyle('plain')");
    expect(serverListHeader).toContain('glassEffect({');
    expect(serverListHeader).toContain("glass: { variant: 'regular', interactive: true }");
    expect(serverListHeader).toContain("shape: 'circle'");
    expect(serverListHeader).toContain('systemName="chevron.left"');
    expect(serverListHeader).toContain('systemName="plus"');
    expect(serverListHeader).toContain('size={20}');
    expect(serverListHeader).toContain('color="#AEAEB2"');
    expect(serverListHeader).toContain("font({ weight: 'semibold' })");
    expect(serverListHeader).toContain('padding()');
    expect(serverListHeader).toContain('setShowServerList(false)');
    expect(serverListHeader).toContain('openAddServer');
    expect(serverListHeader).not.toContain('left={');
    expect(serverListHeader).not.toContain('right={');
  });
});
