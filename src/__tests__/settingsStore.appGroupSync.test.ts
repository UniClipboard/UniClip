import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveServers, saveSettings } from 'app-group-store';
import { ConfigStorage } from '../services/ConfigStorage';
import { useSettingsStore } from '../stores/settingsStore';

const mockNotifyServerChanged = jest.fn();
jest.mock('../stores/syncEngineStore', () => ({
  notifyServerChanged: (...args: unknown[]) => mockNotifyServerChanged(...args),
}));

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const next = Object.create(actual);
  Object.defineProperty(next, 'Platform', {
    value: {
      ...actual.Platform,
      OS: 'ios',
    },
  });
  return next;
});

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockSaveServers = saveServers as jest.Mock;
const mockSaveSettings = saveSettings as jest.Mock;

describe('settings store App Group writes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);

    const storage = ConfigStorage.getInstance() as unknown as {
      initialized: boolean;
      config: unknown;
    };
    storage.initialized = false;
    storage.config = null;

    useSettingsStore.setState({
      config: null,
      isLoaded: false,
      isSaving: false,
      error: null,
      isTempDisabledBackgroundTasks: false,
    });
  });

  it('notifies the sync engine when the active server configuration changes', async () => {
    await useSettingsStore.getState().addServer({
      type: 'syncclipboard',
      name: 'Primary',
      url: 'https://server.example.com/',
      username: 'alice',
      password: 'secret',
    });
    mockNotifyServerChanged.mockClear();

    await useSettingsStore.getState().updateServer(0, {
      url: 'https://new-server.example.com/',
      password: 'new-secret',
    });

    expect(mockNotifyServerChanged).toHaveBeenCalledTimes(1);
    await useSettingsStore.getState().deleteServer(0);
  });

  it('writes the added server to the App Group before addServer resolves on iOS', async () => {
    await useSettingsStore.getState().addServer({
      type: 'syncclipboard',
      name: 'Primary',
      url: 'https://server.example.com/',
      username: 'alice',
      password: 'secret',
    });

    expect(mockSaveServers).toHaveBeenCalledWith({
      configs: [
        {
          id: 'https://server.example.com',
          name: 'Primary',
          urls: ['https://server.example.com'],
          username: 'alice',
          password: 'secret',
        },
      ],
      activeConfigId: 'https://server.example.com',
    });
    expect(mockSaveSettings).toHaveBeenCalled();
  });
});
