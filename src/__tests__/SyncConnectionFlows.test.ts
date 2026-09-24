import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('unified sync connection flows', () => {
  it('provides platform-specific create and join flows', () => {
    const entry = source('components/AddSyncConnectionSheet.tsx');
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const flow = source('components/useAddSyncConnectionFlow.ts');

    expect(entry).toContain("export * from './AddSyncConnectionSheet.android'");
    expect(android).toContain('Host,');
    expect(android).toMatch(/<Host[^>]*>\s*<AddSyncConnectionSheetContent/);
    expect(android).toMatch(/<AddSyncConnectionSheetContent[^>]*\/>\s*<\/Host>/);
    expect(android).not.toContain('initialFullyExpanded');
    // Input stages fill the screen above the keyboard; the other stages wrap their content.
    expect(android).toContain('<ModalBottomSheet ref={sheetRef} skipPartiallyExpanded');
    expect(android).toContain(
      "const takesInput = stage === 'create' || stage === 'joinCode' || stage === 'joinDetails';"
    );
    expect(android).toContain(
      '...(takesInput ? [fillMaxSize(), imePadding()] : [fillMaxWidth()])'
    );
    for (const platform of [android, ios]) {
      expect(platform).toContain('useAddSyncConnectionFlow');
      expect(platform).toContain('completeConnection');
      expect(platform).not.toContain('legacyLan');
      expect(platform).not.toContain('onOpenLegacyLan');
    }
    expect(flow).toContain('.createSpace(');
    expect(flow).toContain('.joinSpace(');
    expect(flow).toContain('completeConnection');
  });

  it('applies the selected app theme to the Android add-connection sheet', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');

    expect(android).toContain("import { useTheme } from '@/hooks/useTheme'");
    expect(android).toMatch(
      /<Host\s+colorScheme=\{theme\.isDark \? 'dark' : 'light'\}\s+seedColor=\{MATERIAL_SEED_COLOR\}\s*>[\s\S]*<AddSyncConnectionSheetContent/
    );
    expect(android).toMatch(
      /function AddSyncConnectionSheetContent[\s\S]*const colors = useMaterialColors\(\)/
    );
  });

  it('uses one continuous iOS layout for device status problems', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(ios).toContain('exclamationmark.triangle.fill');
    expect(ios).toContain('space.flow.deviceUpdate.attention.blockedTitle');
    expect(ios).not.toContain('DeviceUpdateStatusRow');
    expect(ios).toMatch(
      /deviceUpdate\.phase === 'needsAttention' \? \(\s*<IosSheetScaffold[\s\S]*footer=\{[\s\S]*space\.flow\.deviceUpdate\.attention\.cancelAction[\s\S]*contentAlignment="center"/
    );
    expect(ios).toContain("buttonStyle('plain')");
  });

  it('keeps every iOS pairing action in the shared bottom action region', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const scaffold = source('components/ui/IosSheetPage.ios.tsx');
    const design = fs.readFileSync(path.resolve(root, '../DESIGN.md'), 'utf8');

    expect(ios).toContain('IosSheetScaffold');
    expect(ios.match(/<IosSheetScaffold/g)?.length).toBeGreaterThanOrEqual(8);
    expect(scaffold).toContain('maxHeight: Infinity');
    expect(scaffold).toContain('padding({ horizontal: 20, top: 10, bottom: 16 })');
    expect(design).toContain('Content height must never determine the action');
    expect(design).toContain('Do not wrap the action region in a card');
  });

  it('gives the iOS add sheet a native hierarchy instead of a flat button list', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(ios).toContain('IosSheetPage');
    expect(ios).toContain('ConnectionChoice');
    expect(ios).toContain("t('space.create.description')");
    expect(ios).toContain("t('space.join.description')");
    expect(ios).toContain("t('connection.addSheetTitle')");
    expect(ios).toContain('HeaderCircleButton');
    expect(ios).toContain("presentationDetents(['medium', 'large']");
    expect(ios).toContain('isDisabled={!canSubmitDetails || pending}');
    expect(ios).toContain('iosDimensions.surfaceCornerRadius');
  });

  it('keeps every pairing stage at the medium detent so actions stay visible', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(ios).toContain("useState<PresentationDetent>('medium')");
    expect(ios).toContain("setSheetDetent('medium')");
    expect(ios).not.toContain('fullHeight');
    expect(ios).toContain('selection: sheetDetent');
    expect(ios).toContain('onSelectionChange: setSheetDetent');
  });

  it('turns create and join into a staged connection experience on both platforms', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain("'joinCode'");
      expect(platform).toContain("'joinDetails'");
      expect(platform).toContain("'invitation'");
      expect(platform).toContain("'success'");
      expect(platform).toContain('space.flow.waitingTitle');
      expect(platform).toContain('space.flow.successTitle');
      expect(platform).toContain('normalizeInvitationCodeInput');
      expect(platform).toContain('formatInvitationCode');
    }

    expect(android).toContain('space.flow.joinCodeTitle');
    expect(android).toMatch(
      /mode === 'joinUpdating' \|\| mode === 'joinReady'[\s\S]*space\.flow\.joinCodeSheetTitle/
    );
    expect(ios).toContain('space.flow.joinCodeSheetTitle');
  });

  it('accepts formatted codes without silently truncating pasted input', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).not.toMatch(/maxLength=\{[68]\}/);
      expect(platform).not.toContain('invitationCodeRef.current?.setText');
    }
  });

  it('presents the iOS invitation input as a six-cell numeric field', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const joinCodeStart = ios.indexOf("{mode === 'joinCode' ? (");
    const joinDetailsStart = ios.indexOf("{mode === 'joinDetails' ? (", joinCodeStart);
    const joinCodeStep = ios.slice(joinCodeStart, joinDetailsStart);

    expect(ios).toContain('function InvitationCodeField');
    expect(ios).toContain('Array.from({ length: 6 }');
    expect(ios).toContain('slice(0, 3)');
    expect(ios).toContain('slice(3, 6)');
    expect(ios).toContain('inputRef.current?.focus()');
    expect(ios).toContain('<InvitationCodeField');
    expect(ios).toContain('code={invitationCode}');
    expect(ios).toContain('if (normalized !== value) invitationCodeState.value = normalized');
    expect(ios).toContain("keyboardType('numeric')");
    expect(source('components/AddSyncConnectionSheet.android.tsx')).toContain(
      "keyboardType: 'number'"
    );
    expect(ios).toContain('autoFocus');
    expect(ios).toContain('ClipboardProxy.getStringAsync()');
    expect(ios).toContain("t('space.flow.pasteInvitation')");
    expect(ios).toContain('function ConnectionErrorMessage');
    expect(joinCodeStep).not.toContain('padding({ top:');
    expect(joinCodeStep).not.toContain("font({ size: 19, weight: 'semibold' })");
    expect(ios).toContain(
      "const canGoBack = mode === 'joinDetails' && !showsJoinStatus;"
    );
  });

  it('supports copy, share, expiry, and network scope while the creator waits', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const flow = source('components/useAddSyncConnectionFlow.ts');

    for (const platform of [android, ios]) {
      expect(platform).toContain('copyInvitation');
      expect(platform).toContain('shareInvitation');
      expect(platform).toContain('invitationExpired');
      expect(platform).toContain("invitation.availability === 'sameLocalNetwork'");
      expect(platform).toContain('space.flow.waitingForDevice');
    }
    expect(flow).toContain('Clipboard.setStringAsync');
    expect(flow).toContain('Share.share');
    expect(flow).toContain('invitation.expiresAtMs');
  });

  it('keeps Android invitation states on one continuous sheet surface', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const invitationStart = android.indexOf("{mode === 'invitation' && invitation ? (");
    const successStart = android.indexOf("{mode === 'success' ? (", invitationStart);
    const invitationStep = android.slice(invitationStart, successStart);

    // Stages wrap their content; a fixed height fraction pushed actions below the fold.
    expect(android).not.toContain('fillMaxHeight(');
    expect(android).not.toContain('partialExpand(');
    expect(invitationStep).toContain("'space.flow.waitingForDevice'");
    expect(invitationStep).toContain("'space.flow.expiredBody'");
    expect(invitationStep).toContain("t('space.flow.renewInvitation')");
    expect(invitationStep).toContain('<InvitationCodeCard');
    // The waiting stage stays minimal: status line, code card, network hint, share, finish later.
    expect(invitationStep).not.toContain('<DevicePair');
    expect(invitationStep).not.toContain('<MetaChip');
    expect(invitationStep).not.toContain('space.flow.waitingBody');
    expect(android).toContain('modifiers={[fillMaxWidth(), clickable(onCopy)]}');
    expect(invitationStep).not.toContain('DEVICE_NAME_STYLE');
  });

  it('renders every Android pairing status through the shared M3 Expressive status layout', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const statusStart = android.indexOf("{mode === 'joinDetails' ? (");
    const statusSteps = android.slice(statusStart);

    expect(android).toContain('function PairingStatus');
    expect(android).toContain('function IconBadge');
    expect(android).toContain('function DevicePair');
    expect(android).toContain('function ConnectionChoiceRow');
    expect(android).toContain('const PILL_SHAPE = Shape.Pill(');
    expect(android).toContain('LoadingIndicator');
    expect(statusSteps.match(/<PairingStatus/g)?.length).toBeGreaterThanOrEqual(3);
    expect(statusSteps).not.toContain('<CircularProgressIndicator');
    expect(android).toContain('function InvitationCodeCard');
    expect(android).toContain('function InlineConnectionError');
    expect(android).toContain('const HERO_BADGE_SHAPE = Shapes.Material.Cookie9Sided;');
    expect(android).toContain('<ContainedLoadingIndicator');
    expect(android).toContain('<LinearWavyProgressIndicator');
    expect(android).toContain('position="first"');
    expect(android).toContain('position="last"');
  });

  it('keeps the Android connected state compact with its action directly below', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const successStart = android.indexOf("{mode === 'success' ? (");
    const updateStart = android.indexOf("{mode === 'joinUpdating' ? (", successStart);
    const successStep = android.slice(successStart, updateStart);

    expect(android).toContain('sheetRef.current?.expand()');
    expect(successStep).toContain('CONNECTED_DEVICE_STYLE');
    expect(successStep).toContain('maxLines={2}');
    expect(successStep).not.toContain('weight(1)');
    expect(successStep).not.toContain('<Surface');
  });

  it('renders every iOS pairing status through one shared status layout', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const statusStart = ios.indexOf("{mode === 'joinDetails' ? (");
    const statusSteps = ios.slice(statusStart);

    expect(ios).toContain('function PairingStatus');
    expect(ios).toContain('function PairingSymbol');
    expect(ios).toContain('function DevicePair');
    expect(ios).toContain('function SheetActionButton');
    expect(ios).toContain("buttonBorderShape('capsule')");
    expect(ios).toContain("repeat: 'continuous'");
    expect(statusSteps.match(/<PairingStatus/g)?.length).toBeGreaterThanOrEqual(6);
    expect(statusSteps).not.toContain('<ProgressView');
    expect(statusSteps).toContain("'space.flow.expiredBody'");
    expect(statusSteps).toContain("t('space.flow.renewInvitation')");
    expect(statusSteps).toContain('<InvitationCodeCard');
    // The waiting stage mirrors Android: status line, tappable code card, network hint, share.
    expect(ios).not.toContain("title={t('space.flow.copyInvitation')}");
    expect(ios).toContain('onCopy={() => void copyInvitation()}');
  });

  it('switches both platforms from join inputs to status-only UX after submission', () => {
    const flow = source('components/useAddSyncConnectionFlow.ts');
    const preview = source('devtools/useAddSyncConnectionPreviewFlow.ts');
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(flow).toContain('setJoinSubmitted(true)');
    expect(flow).toContain('const editJoinDetails = () =>');
    expect(preview).toContain('joinSubmitted: true');
    for (const platform of [android, ios]) {
      expect(platform).toContain('showsJoinStatus');
      expect(platform).toContain('space.join.failedTitle');
      expect(platform).toContain('space.join.editDetails');
    }
  });

  it('keeps completed pairing sheets complete while Engine notifies removed devices', () => {
    const flow = source('components/useAddSyncConnectionFlow.ts');
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(flow).toContain('removalAcknowledgementPending');
    for (const platform of [android, ios]) {
      expect(platform).toContain('removalAcknowledgementPending');
      expect(platform).toContain('space.flow.deviceUpdate.removalNotificationPending');
      expect(platform).toContain("mode === 'joinReady'");
    }
  });

  it('bases pairing completion only on the public space device update', () => {
    const flow = source('components/useAddSyncConnectionFlow.ts');
    const completion = flow.slice(
      flow.indexOf('function currentJoinCompletionMode'),
      flow.indexOf('function remainingTime')
    );

    expect(completion).toContain("query.snapshot.spaceDeviceUpdate.phase === 'completed'");
    expect(completion).not.toContain('groupRelationship');
    expect(completion).not.toContain('membership');
    expect(completion).not.toContain('syncRelationship');
    expect(completion).not.toContain('reachability');
  });

  it('uses the unified add sheet instead of duplicate setup forms in settings', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/ios/DevicesScreen.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('AddSyncConnectionSheet');
      expect(platform).not.toContain('.createSpace(');
      expect(platform).not.toContain('.joinSpace(');
    }
  });

  it('does not reset native fields after connection completion unmounts the sheet', () => {
    const flow = source('components/useAddSyncConnectionFlow.ts');
    const completion = flow.slice(
      flow.indexOf('const completeConnection'),
      flow.indexOf('const close')
    );

    expect(flow).toContain('mountedRef');
    expect(completion).toMatch(/if \(!mountedRef\.current\) return\b[\s\S]*reset\(\)/);
  });

  it('clears iOS sensitive fields and restores the default device name on reset', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const flow = source('components/useAddSyncConnectionFlow.ts');

    expect(ios).toContain('resetNativeFields: (nextDeviceName)');
    expect(ios).toContain('deviceNameState.value = nextDeviceName');
    expect(ios).toContain('passphraseRef.current?.clear()');
    expect(ios).toContain('invitationCodeRef.current?.clear()');
    expect(flow).toContain('setDeviceName(defaultDeviceName)');
    expect(flow).toContain("setPassphrase('')");
    expect(flow).toContain("setInvitationCode('')");
  });

  it('shows the default device name in both iOS setup fields', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(ios).toContain('useNativeState(defaultDeviceName)');
    expect(ios.match(/text=\{deviceNameState\}/g)).toHaveLength(2);
    expect(ios).toContain('deviceNameState.value = nextDeviceName');
  });

  it('focuses the space password when the iOS create sheet opens', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const createStart = ios.indexOf("{mode === 'create' ? (");
    const joinStart = ios.indexOf("{mode === 'joinCode' ? (", createStart);
    const createStep = ios.slice(createStart, joinStart);

    expect(createStep).toMatch(/<SecureField[\s\S]*autoFocus/);
  });

  it('explains the space password in plain language in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(source(`i18n/locales/${locale}/settingsSync.json`));

      expect(messages.space.flow.createBody.length).toBeGreaterThan(30);
      expect(messages.space.flow.joinDetailsBody.length).toBeGreaterThan(30);
      expect(messages.space.error.joinExpired).toEqual(expect.any(String));
      expect(messages.space.error.joinSuperseded).toEqual(expect.any(String));
    }

    const zh = JSON.parse(source('i18n/locales/zh/settingsSync.json'));
    const en = JSON.parse(source('i18n/locales/en/settingsSync.json'));
    const zhPasswordCopy = [
      zh.space.footer,
      zh.space.field.passphrase,
      zh.space.flow.createBody,
      zh.space.flow.joinDetailsBody,
      zh.space.error.passphraseRequired,
      zh.space.error.passphraseMismatch,
    ];
    const enPasswordCopy = [
      en.space.footer,
      en.space.field.passphrase,
      en.space.flow.createBody,
      en.space.flow.joinDetailsBody,
      en.space.error.passphraseRequired,
      en.space.error.passphraseMismatch,
    ];
    expect(zhPasswordCopy.join('\n')).not.toContain('口令');
    expect(enPasswordCopy.join('\n')).not.toContain('passphrase');
  });

  it('uses the system device name as the setup default on both platforms', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain("import * as Device from 'expo-device'");
      expect(platform).toContain('resolveDefaultDeviceName(');
      expect(platform).toContain('Device.deviceName');
      expect(platform).toContain('Device.modelName');
    }
  });

  it('keeps connection setup out of Home overlays', () => {
    const overlays = source('screens/HomeOverlays.tsx');

    expect(overlays).not.toContain('AddSyncConnectionSheet');
    expect(overlays).not.toContain('MySpaceSheet');
    expect(overlays).not.toContain('legacyLan');
    expect(overlays).not.toContain('AddServer');
  });

  it('ships the staged connection copy in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(source(`i18n/locales/${locale}/settingsSync.json`));

      expect(messages.space.flow.joinCodeSheetTitle).toEqual(expect.any(String));
      expect(messages.space.flow.joinCodeTitle).toEqual(expect.any(String));
      expect(messages.space.flow.pasteInvitation).toEqual(expect.any(String));
      expect(messages.space.flow.waitingTitle).toEqual(expect.any(String));
      expect(messages.space.flow.waitingForDevice).toEqual(expect.any(String));
      expect(messages.space.flow.successTitle).toEqual(expect.any(String));
      expect(messages.space.flow.deviceUpdate.removalNotificationPending).toEqual(
        expect.any(String)
      );
      expect(messages.space.error.invitationCodeInvalid).toEqual(expect.any(String));
      expect(messages.space.error.invitationNotFound).toEqual(expect.any(String));
      expect(messages.space.error.invitationExpired).toEqual(expect.any(String));
      expect(messages.space.error.passphraseMismatch).toEqual(expect.any(String));
      expect(messages.space.switch.confirmTitle).toEqual(expect.any(String));
      expect(messages.space.switch.confirm).toEqual(expect.any(String));
      expect(messages.space.switch.confirmAction).toEqual(expect.any(String));
    }
  });
});

describe('iOS two-step join sheet', () => {
  const ios = () => source('components/AddSyncConnectionSheet.ios.tsx');
  const joinDetailsStep = () => {
    const text = ios();
    const start = text.indexOf("{mode === 'joinDetails' ? (");
    return text.slice(start, text.indexOf("{mode === 'invitation'", start));
  };

  it('omits a step indicator from the join steps', () => {
    const text = ios();

    expect(text).not.toContain('JoinStepProgress');
    expect(text).not.toContain('space.flow.stepProgress');
  });

  it('advances to the password step only on a fresh code completion', () => {
    const text = ios();

    expect(text).toContain('!codeComplete && normalizeInvitationCodeInput(normalized).length === 6');
    expect(text).toMatch(
      /mode !== 'joinCode' \|\| !autoAdvanceRef\.current[\s\S]*autoAdvanceRef\.current = false;\s*continueFromCode\(\)/
    );
  });

  it('keeps the invitation code editable and the password revealable in step two', () => {
    const step = joinDetailsStep();

    expect(step).toMatch(/<InvitationCodeChip[\s\S]*onPress=\{back\}/);
    expect(step).toContain('nativeText={passphraseState}');
    expect(ios()).toMatch(/<TextField\s+text=\{nativeText\}/);
    expect(ios()).toMatch(/<SecureField\s+ref=\{inputRef\}\s+text=\{nativeText\}/);
    expect(ios()).toContain("passphraseState.value = ''");
  });

  it('collapses the device name into a full-width tappable row', () => {
    const text = ios();
    const row = text.slice(
      text.indexOf('function JoinDeviceNameRow'),
      text.indexOf('function InlineConnectionError')
    );

    expect(joinDetailsStep()).toContain('onPress={() => setEditingDeviceName(true)}');
    expect(row).toContain("modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}");
    expect(row).toContain('contentShape(shapes.rectangle())');
    expect(row).toContain('<Spacer />');
  });

  it('translates the new join copy in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const flow = JSON.parse(source(`i18n/locales/${locale}/settingsSync.json`)).space.flow;
      for (const key of [
        'joinPassphraseTitle',
        'editInvitationCode',
        'editInvitationCodeAccessibility',
        'showPassphrase',
        'hidePassphrase',
        'joinAsDevice',
        'renameDevice',
      ]) {
        expect(flow[key]).toEqual(expect.any(String));
      }
    }
  });
});

describe('Android two-step join sheet', () => {
  const android = () => source('components/AddSyncConnectionSheet.android.tsx');
  const joinDetailsStep = () => {
    const text = android();
    const start = text.indexOf("{mode === 'joinDetails' ? (");
    return text.slice(start, text.indexOf("{mode === 'invitation'", start));
  };

  it('uses a six-cell code field decorated around a bare Compose input', () => {
    const text = android();

    expect(text).toContain('function InvitationCodeCells');
    expect(text).toMatch(/<BasicTextField[\s\S]*<BasicTextField\.DecorationBox>/);
    expect(text).toContain('<BasicTextField.InnerTextField />');
    expect(text).toContain('Array.from({ length: 6 }');
    expect(text).toContain("t('space.flow.pasteInvitation')");
    expect(text).not.toContain('step={1}');
  });

  it('advances to the password step only on a fresh code completion', () => {
    const text = android();

    expect(text).toContain('!codeComplete && normalizeInvitationCodeInput(normalized).length === 6');
    expect(text).toMatch(
      /mode !== 'joinCode' \|\| !autoAdvanceRef\.current[\s\S]*autoAdvanceRef\.current = false;\s*continueFromCode\(\)/
    );
  });

  it('keeps the code editable and the password revealable in step two', () => {
    const step = joinDetailsStep();

    expect(step).toMatch(/<InvitationCodeChip[\s\S]*onClick=\{back\}/);
    expect(step).toContain("visualTransformation={passphraseRevealed ? 'none' : 'password'}");
    expect(step).toContain('<OutlinedTextField.TrailingIcon>');
    expect(step).toContain('isError={Boolean(error)}');
  });

  it('collapses the device name into a full-width clickable row', () => {
    const text = android();
    const row = text.slice(
      text.indexOf('function JoinDeviceNameRow'),
      text.indexOf('function InlineConnectionError')
    );

    expect(joinDetailsStep()).toContain('onClick={() => setEditingDeviceName(true)}');
    expect(row).toMatch(/<Row[\s\S]*fillMaxWidth\(\),[\s\S]*clickable\(onClick\)/);
    expect(row).toContain('weight(1)');
  });

  it('slides Android sheets out before in-sheet buttons close them', () => {
    const addConnection = source('components/AddSyncConnectionSheet.android.tsx');
    const flow = source('components/useAddSyncConnectionFlow.ts');

    expect(addConnection).toMatch(/presentation: \{[\s\S]*await sheetRef\.current\?\.hide\(\)/);
    expect(flow).not.toContain('Platform.OS');
  });
});
