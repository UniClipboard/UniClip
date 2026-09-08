import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { useOnboardingConnection } from '@/screens/onboarding/useOnboardingConnection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const intent = {
  name: 'Computer',
  urls: ['http://computer.local'],
  username: 'phone',
  password: 'hidden',
};
const mockScan = jest.fn();
const mockProbe = jest.fn();
const mockSave = jest.fn();
const mockSettings = { loadConfig: jest.fn(async () => undefined), error: null as string | null };
jest.mock('@/features/lan-servers/scanLanConnection', () => ({
  scanLanConnection: (...args: unknown[]) => mockScan(...args),
}));
jest.mock('@/features/lan-servers', () => ({
  probeLanServers: (...args: unknown[]) => mockProbe(...args),
  getLanServerService: () => ({ save: mockSave }),
}));
jest.mock('@/features/settings', () => ({ useSettingsStore: { getState: () => mockSettings } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('welcome QR confirmation flow', () => {
  let flow: ReturnType<typeof useOnboardingConnection>;
  let renderer: ReactTestRenderer;
  function Harness() {
    flow = useOnboardingConnection();
    return null;
  }
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.error = null;
    mockScan.mockResolvedValue(intent);
    mockProbe.mockResolvedValue({ [intent.urls[0]]: 'Success' });
    mockSave.mockResolvedValue({ id: 'saved', ...intent });
    act(() => {
      renderer = TestRenderer.create(<Harness />);
    });
  });
  afterEach(() => act(() => renderer.unmount()));
  it('scans into confirmation without contacting or saving the computer', async () => {
    await act(async () => flow.scan());
    expect(flow.stage).toBe('confirm');
    expect(flow.intent).toEqual(intent);
    expect(mockProbe).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('returns to introduction when scanning is cancelled', async () => {
    mockScan.mockResolvedValue(null);
    await act(async () => flow.scan());
    expect(flow.stage).toBe('intro');
    expect(flow.busy).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('keeps the same confirmation on failure and succeeds after retry', async () => {
    await act(async () => flow.scan());
    mockProbe.mockResolvedValueOnce({ [intent.urls[0]]: 'AuthFailed' });
    await act(async () => flow.connect());
    expect(flow.stage).toBe('confirm');
    expect(flow.error).toBe('lan.probe.authFailed');
    expect(mockSave).not.toHaveBeenCalled();
    await act(async () => flow.connect());
    expect(flow.stage).toBe('success');
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSettings.loadConfig).toHaveBeenCalledTimes(1);
  });
  it('does not create duplicate connections when refreshing settings needs retry', async () => {
    await act(async () => flow.scan());
    mockSettings.error = 'refresh failed';
    await act(async () => flow.connect());
    expect(flow.stage).toBe('confirm');
    mockSettings.error = null;
    await act(async () => flow.connect());
    expect(flow.stage).toBe('success');
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
  it('ignores repeated taps while checking the connection', async () => {
    await act(async () => flow.scan());
    let resolve!: (value: object) => void;
    mockProbe.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    let pending!: Promise<void>;
    act(() => {
      pending = flow.connect();
    });
    await act(async () => flow.connect());
    expect(mockProbe).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ [intent.urls[0]]: 'Success' });
      await pending;
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
  it('does not save when the screen was closed while the network check was pending', async () => {
    await act(async () => flow.scan());
    let resolve!: (value: object) => void;
    mockProbe.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    let pending!: Promise<void>;
    act(() => {
      pending = flow.connect();
    });
    act(() => renderer.unmount());
    await act(async () => {
      resolve({ [intent.urls[0]]: 'Success' });
      await pending;
    });
    expect(mockSave).not.toHaveBeenCalled();
  });
});
