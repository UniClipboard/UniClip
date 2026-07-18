/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('iOS settings server list', () => {
  const orchestratorSource = readSource('screens/SettingsScreen.ios.tsx');
  const rootPageSource = readSource('screens/settings/ios/SettingsRootPage.tsx');
  const serverListSource = readSource('screens/settings/ios/ServerListPage.tsx');
  const diagnosticsSource = readSource('screens/settings/ios/DiagnosticsPage.tsx');
  const commonSource = readSource('screens/settings/ios/common.tsx');

  it('opens a dedicated server list page from the root server row', () => {
    expect(rootPageSource).toContain("onNavigate('servers')");
    expect(orchestratorSource).toContain("page === 'servers'");
    expect(orchestratorSource).toContain('ServerListPage');
    expect(commonSource).toContain('onTapGesture');
  });

  it('opens diagnostics from About and cleans the package after system sharing', () => {
    expect(rootPageSource).toContain("onNavigate('diagnostics')");
    expect(orchestratorSource).toContain("page === 'diagnostics'");
    expect(orchestratorSource).toContain('DiagnosticsPage');
    expect(diagnosticsSource).toContain('createDiagnosticPackage');
    expect(diagnosticsSource).toContain('await shareFile(artifact.uri, artifact.fileName)');
    expect(diagnosticsSource).toContain('if (artifact) deleteDiagnosticPackage(artifact.uri)');
    expect(diagnosticsSource).toContain('disabled(isGenerating || !config)');
  });

  it('uses the unified server sheet for adding and editing servers', () => {
    expect(orchestratorSource).toContain('AddServerSheet');
    expect(orchestratorSource).toContain('editingServerIndex');
    expect(orchestratorSource).toContain('updateServer');
    expect(orchestratorSource).toContain('addServer');
  });

  it('uses icon-only current server state and shows address count with url', () => {
    expect(serverListSource).toContain(
      "systemImage={isActive ? 'checkmark.circle.fill' : 'server.rack'}"
    );
    expect(serverListSource).toContain('getServerAddressCount');
    expect(serverListSource).not.toContain('当前使用');
  });

  it('nests the add/edit sheet inside the settings sheet on iOS', () => {
    expect(orchestratorSource.indexOf('<AddServerSheet')).toBeGreaterThan(
      orchestratorSource.indexOf('<BottomSheet')
    );
    expect(orchestratorSource.indexOf('<AddServerSheet')).toBeLessThan(
      orchestratorSource.indexOf('</BottomSheet>')
    );
    expect(orchestratorSource).toContain('embeddedInHost');
  });

  it('does not add another Host into the settings sheet layout', () => {
    const sheetSource = readSource('components/AddServerSheet.ios.tsx');

    expect(sheetSource).toContain('embeddedInHost = false');
    expect(sheetSource).toContain('return embeddedInHost ? (');
  });

  it('uses the same grouped background behind the server list header and body', () => {
    const sheetPageSource = readSource('components/ui/IosSheetPage.ios.tsx');

    expect(serverListSource).toContain('IosSheetPage');
    expect(serverListSource).toContain('IosSheetForm');
    expect(sheetPageSource).toContain('iosColors?.systemGroupedBackground');
    expect(sheetPageSource).toContain('background(sheetPageBackgroundColor)');
  });

  it('uses the shared left and right header button slots for the server list', () => {
    expect(serverListSource).toContain('leftSlots={[');
    expect(serverListSource).toContain('rightSlots={[');
    expect(serverListSource).toContain('systemName="chevron.left"');
    expect(serverListSource).toContain('systemName="plus"');
    expect(serverListSource).toContain('onPress={onBack}');
    expect(serverListSource).toContain('onPress={onAddServer}');
    expect(serverListSource).not.toContain('left={');
    expect(serverListSource).not.toContain('right={');
  });

  it('keeps the glass circular header button styling in the shared helper', () => {
    expect(commonSource).toContain("buttonStyle('plain')");
    expect(commonSource).toContain('glassEffect({');
    expect(commonSource).toContain("glass: { variant: 'regular', interactive: true }");
    expect(commonSource).toContain("shape: 'circle'");
    expect(commonSource).toContain('size={20}');
    expect(commonSource).toContain("font({ weight: 'semibold' })");
    expect(commonSource).toContain('padding()');
  });
});
