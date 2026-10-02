import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  ClipboardAccessMethodSheetProvider,
  useClipboardAccessMethodSheet,
} from '../screens/settings/ClipboardAccessMethodSheet.android';

const mockSetString = jest.fn();

jest.mock('expo-clipboard', () => ({
  setStringAsync: (v: string) => mockSetString(v),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/ui', () => ({
  AppBottomSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null,
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: new Proxy({}, { get: () => '#000000' }),
    },
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Controller = ReturnType<typeof useClipboardAccessMethodSheet>;

async function mount() {
  let controller!: Controller;
  function Probe() {
    controller = useClipboardAccessMethodSheet();
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ClipboardAccessMethodSheetProvider>
        <Probe />
      </ClipboardAccessMethodSheetProvider>
    );
  });
  return { renderer, controller: () => controller };
}

const textOf = (renderer: TestRenderer.ReactTestRenderer) => JSON.stringify(renderer.toJSON());

function subtreeText(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : subtreeText(child)))
    .join('|');
}

function findButton(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.onPress === 'function' &&
      subtreeText(node).includes(label)
  )[0];
}

describe('ClipboardAccessMethodSheet (Android)', () => {
  beforeEach(() => mockSetString.mockClear());

  it('shows all methods at once and keeps the footer disabled while the current one is selected', async () => {
    const onSelect = jest.fn();
    const { renderer, controller } = await mount();
    await act(async () => {
      controller().openMethodSheet({
        selectedMethod: 'overlay-polling',
        onSelect,
      });
    });

    const json = textOf(renderer);
    ['overlay-polling', 'overlay-event', 'shizuku'].forEach((m) =>
      expect(json).toContain(`sheet.methods.${m}.title`)
    );
    expect(json).toContain('sheet.currentButton');

    const adbCard = renderer.root.findAll(
      (n) =>
        n.props.accessibilityRole === 'radio' &&
        n.props.accessibilityLabel?.includes('overlay-event')
    )[0];
    await act(async () => adbCard.props.onPress());
    expect(textOf(renderer)).toContain('sheet.continue.overlay-event');

    await act(async () => findButton(renderer, 'sheet.continue.overlay-event').props.onPress());
    expect(onSelect).toHaveBeenCalledWith('overlay-event');
  });

  it('copies adb devices locally and delegates the grant command to the caller', async () => {
    const onCopy = jest.fn();
    const { renderer, controller } = await mount();
    await act(async () => {
      controller().openAdbSetupSheet({
        stage: 'instructions',
        command: 'adb shell pm grant app.test android.permission.READ_LOGS',
        onCopy,
        onCheck: jest.fn(),
      });
    });

    const copyButtons = renderer.root.findAll(
      (n) =>
        n.props.accessibilityLabel === 'advanced.clipboardAccess.adbGuide.copy' &&
        n.parent?.props.accessibilityLabel !== n.props.accessibilityLabel
    );
    expect(copyButtons).toHaveLength(2);
    await act(async () => copyButtons[0].props.onPress());
    expect(mockSetString).toHaveBeenCalledWith('adb devices');
    await act(async () => copyButtons[1].props.onPress());
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(textOf(renderer)).toContain('adbGuide.copied');
  });

  it('renders the Shizuku guide per stage', async () => {
    const onAction = jest.fn();
    const { renderer, controller } = await mount();
    await act(async () => {
      controller().openShizukuSetupSheet({
        stage: 'authorize',
        command: 'adb shell sh start.sh',
        onAction,
        onCheck: jest.fn(),
      });
    });
    expect(textOf(renderer)).toContain('shizukuGuide.authorize');
    expect(textOf(renderer)).not.toContain('adb shell sh start.sh');

    await act(async () => {
      controller().openShizukuSetupSheet({
        stage: 'notRunning',
        command: 'adb shell sh start.sh',
        onAction,
        onCheck: jest.fn(),
      });
    });
    expect(textOf(renderer)).toContain('adb shell sh start.sh');
    await act(async () => findButton(renderer, 'shizukuGuide.open').props.onPress());
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
