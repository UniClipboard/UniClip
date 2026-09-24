import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

function source(relativePath: string): string {
  const absolutePath = path.join(process.cwd(), relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}

describe('LAN server UI ownership', () => {
  it('routes cold and hot LAN connection links through one redacted handler', () => {
    const app = source('App.tsx');

    expect(app).toContain('ingestLanConnectUrl');
    expect(app).toContain('openLanServerSettings');
    expect(app).toContain('handleLanConnectUrl');
    expect(app.match(/handleLanConnectUrl\(url\)/g)).toHaveLength(2);
    expect(app).not.toMatch(/console\.(?:log|info|warn|error).*connect/i);
  });

  it('keeps the Android QR scanner at the stable application root', () => {
    const app = source('App.tsx');
    const scanner = source('src/components/LanQrScannerModal.tsx');

    expect(app).toContain('LanQrScannerHost');
    expect(app).toContain('<LanQrScannerHost />');
    expect(scanner).toContain('permissionRequested.current = true;');
    expect(scanner).toContain('permissionRequested.current = false;');
  });

  it('presents the iOS scanner above the active native server sheet', () => {
    const host = source('src/components/LanQrScannerHost.ios.tsx');
    const editor = source('src/screens/settings/ios/LanServerEditorSheet.tsx');
    const nativeScanner = source('modules/qr-scanner/ios/QrScannerModule.swift');

    expect(host).toContain('return null');
    expect(editor).toContain("import { scanQRCode } from 'qr-scanner';");
    expect(editor).toContain('await scanQRCode(');
    expect(nativeScanner).toContain(
      'while let presented = topViewController.presentedViewController'
    );
    expect(nativeScanner).toContain('visibleChildViewController');
    expect(nativeScanner).toContain('topViewController.children.reversed()');
    expect(nativeScanner).toContain('scanner.modalPresentationStyle = .fullScreen');
    expect(nativeScanner).toContain('topViewController.present(scanner, animated: true)');
  });

  it('keeps platform navigation policy outside the shared app component', () => {
    const android = source('src/features/lan-servers/openLanServerSettings.android.ts');
    const ios = source('src/features/lan-servers/openLanServerSettings.ios.ts');

    expect(android).toContain("navigateWhenReady('SettingsSub', { section: 'lanServers' })");
    expect(ios).toContain("navigateWhenReady('Main', { screen: 'Devices' })");
  });

  it('renders the iOS editor from the stable Devices owner', () => {
    const settings = source('src/screens/ios/DevicesScreen.tsx');
    const page = source('src/screens/ios/devices/DevicesRootPage.tsx');
    const editor = source('src/screens/settings/ios/LanServerEditorSheet.tsx');

    expect(settings).toContain('<DevicesRootPage');
    expect(settings).toContain('<LanServerEditorSheet');
    expect(settings.indexOf('<LanServerEditorSheet')).toBeGreaterThan(
      settings.indexOf('</NavigationStack>')
    );
    expect(settings).toContain('consumePendingLanIntent()');
    expect(page).toContain('function LanServersContent');
    expect(page).not.toContain('LanServerEditorSheet');
    expect(editor).toContain('if (value === latestNativeValue.current) return;');
    expect(editor).toContain('onTextChange={handleTextChange}');
    expect(editor).toContain("t('lan.probe.test')");
    expect(editor).toContain('editor.probeResults');
    expect(editor).toContain("props.embedded ? 'chevron.left' : 'xmark'");
    expect(editor).toContain('systemName="checkmark"');
    expect(editor).toContain('disabled={editor.pending || !editor.canSave}');
    expect(editor).not.toContain("<Button label={t('action.cancel', { ns: 'common' })}");
  });

  it('uses full-width Android list rows and a screen-owned editor sheet', () => {
    const page = source('src/screens/settings/LanServersPage.android.tsx');
    const editor = source('src/components/LanServerEditorSheet.android.tsx');

    expect(page).toContain('<ListItem colors={rowColors} modifiers={[clickable(onEdit)]}>');
    expect(page).toContain('<ListItem colors={rowColors} modifiers={[clickable(onAdd)]}>');
    expect(page).toContain('variant="grouped"');
    expect(page).toContain('<LanServerEditorSheet');
    expect(page).toContain('usePendingLanConnectStore');
    expect(editor).toContain('<ModalBottomSheet');
    expect(editor).toContain('verticalScroll()');
    expect(editor).toContain("t('lan.probe.test')");
    expect(editor).toContain('editor.probeResults');
  });

  it('opens the Android server editor directly at full height', () => {
    const editor = source('src/components/LanServerEditorSheet.android.tsx');

    expect(editor).toMatch(/<ModalBottomSheet\s+skipPartiallyExpanded\s+onDismissRequest=/);
  });

  it('keeps Android server save and connection testing outside the scrolling form', () => {
    const editor = source('src/components/LanServerEditorSheet.android.tsx');
    const scrollForm = editor.indexOf('<EditorForm');
    const footer = editor.indexOf('<EditorFooter');

    expect(scrollForm).toBeGreaterThan(0);
    expect(footer).toBeGreaterThan(scrollForm);
    expect(editor).toContain('requestClose');
    expect(editor).toContain("t('lan.discardAction')");
    expect(editor).toContain('imePadding()');
  });

  it('uses a fixed Android editor header before the scrolling form', () => {
    const editor = source('src/components/LanServerEditorSheet.android.tsx');
    const header = editor.indexOf('<EditorHeader');
    const form = editor.indexOf('<EditorForm');

    expect(header).toBeGreaterThan(0);
    expect(form).toBeGreaterThan(header);
    expect(editor).toContain('onClose={requestClose}');
    expect(editor).toContain('source={ICONS.close}');
    expect(editor).toContain("contentDescription={t('action.close', { ns: 'common' })}");
  });

  it('groups the Android form into connection, credentials, and security sections', () => {
    const editor = source('src/components/LanServerEditorSheet.android.tsx');

    expect(editor).toContain("t('lan.connectionInfo')");
    expect(editor).toContain("t('lan.credentials')");
    expect(editor).toContain("t('lan.security')");
    expect(editor).toContain('source={ICONS.qr}');
    expect(editor).not.toContain('<TextButton onClick={onClose}');
    expect(editor).not.toContain("t('lan.serverActions')");
  });

  it('never leaves Android editor setting rows as bare rectangular list items', () => {
    const editor = source('src/components/LanServerEditorSheet.android.tsx');
    const security = editor.match(/function SecurityControl[\s\S]*?function ProbeResults/)?.[0];

    expect(editor).toContain('const EDITOR_GROUP_SHAPE = Shape.RoundedCorner');
    expect(security).toContain('<Surface');
    expect(security).toContain('shape={EDITOR_GROUP_SHAPE}');
    expect(security).toContain('border={{ color: colors.outlineVariant }}');
    expect(security).toContain('verticalAlignment="center"');
    expect(editor).toContain('<ProbeResults editor={editor} />');
  });

  it('keeps Test in the form and gives Delete and Save equal footer widths', () => {
    const editor = source('src/components/LanServerEditorSheet.android.tsx');
    const form = editor.match(/function EditorForm[\s\S]*?function EditorFooter/)?.[0];
    const footer = editor.match(/function EditorFooter[\s\S]*$/)?.[0];
    const deleteAction = footer?.indexOf('source={ICONS.delete}') ?? -1;
    const saveAction = footer?.indexOf("t('action.save', { ns: 'common' })") ?? -1;

    expect(form).toContain("t('lan.probe.test')");
    expect(form).toContain('onClick={() => void editor.probe()}');
    expect(footer).not.toContain("t('lan.probe.test')");
    expect(footer).toContain('<Row');
    expect(footer).toContain('<OutlinedButton');
    expect(footer).toContain('<Button');
    expect(footer?.match(/modifiers=\{\[weight\(1\)\]\}/g)).toHaveLength(2);
    expect(deleteAction).toBeGreaterThan(0);
    expect(saveAction).toBeGreaterThan(deleteAction);
    expect(footer).toContain('serverId ? (');
  });

  it.each(['zh', 'en', 'ru', 'pt-BR'])(
    'provides %s Android server editor section labels',
    (locale) => {
      const messages = JSON.parse(source(`src/i18n/locales/${locale}/settingsSync.json`)) as {
        lan?: Record<string, unknown>;
      };

      expect(messages.lan).toEqual(
        expect.objectContaining({
          connectionInfo: expect.any(String),
          security: expect.any(String),
        })
      );
    }
  );

  it('wraps Android text-field labels and placeholders in Compose text', () => {
    const field = source('src/components/ui/AppTextField.android.tsx');

    expect(field).toContain('<Text>{label}</Text>');
    expect(field).toContain('<Text>{placeholder}</Text>');
    expect(field).toContain('nativeValue.set(value)');
    expect(field).toContain('if (value === latestNativeValue.current) return;');
    expect(field).toContain('onValueChange={handleValueChange}');
    expect(field).toContain(
      "visualTransformation={secure && !secureVisible ? 'password' : undefined}"
    );
    expect(field).toContain('secureToggleLabel');
    expect(field).toContain('tint={colors.onSurfaceVariant}');
    expect(field).not.toContain('<OutlinedTextField.Label>{label}</OutlinedTextField.Label>');
    expect(field).not.toContain(
      '<OutlinedTextField.Placeholder>{placeholder}</OutlinedTextField.Placeholder>'
    );
  });

  it('shows LAN server settings inside the selected sync method pages', () => {
    const iosPage = source('src/screens/ios/devices/DevicesRootPage.tsx');
    const androidPage = source('src/screens/settings/SyncChannelSection.android.tsx');

    expect(iosPage).toContain('<LanServersContent');
    expect(androidPage).toContain('<LanServersPage />');
    expect(iosPage).not.toContain("onNavigate('lanServers')");
    expect(androidPage).not.toContain("openSection('lanServers')");
  });

  it('does not expose a current LAN server selection', () => {
    const androidEditor = source('src/components/LanServerEditorSheet.android.tsx');
    const iosEditor = source('src/screens/settings/ios/LanServerEditorSheet.tsx');
    const androidList = source('src/screens/settings/LanServersPage.android.tsx');
    const iosList = source('src/screens/ios/devices/DevicesRootPage.tsx');
    const editorState = source('src/features/lan-servers/useLanServerEditor.ts');

    for (const content of [androidEditor, iosEditor, androidList, iosList, editorState]) {
      expect(content).not.toContain('activeLanServerId');
      expect(content).not.toContain('makeActive');
      expect(content).not.toContain('isActive');
    }
  });
});
