import { RuntimeStateStorage } from '../services/RuntimeStateStorage';
import { RUNTIME_STATE_DEFAULTS } from '../types/settings';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

const RUNTIME_STATE_KEY = '@syncclipboard:runtime_state';

describe('RuntimeStateStorage', () => {
  let storage: RuntimeStateStorage;
  const mockGetItem = AsyncStorage.getItem as jest.Mock;
  const mockSetItem = AsyncStorage.setItem as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new RuntimeStateStorage();
  });

  describe('load', () => {
    it('returns defaults when no stored data', async () => {
      mockGetItem.mockResolvedValue(null);
      const result = await storage.load();
      expect(result).toEqual(RUNTIME_STATE_DEFAULTS);
    });

    it('loads stored runtime state', async () => {
      mockGetItem.mockResolvedValue(
        JSON.stringify({ lastUpdateCheckDate: '2026-06-20', needsHistoryReorganize: true })
      );
      const result = await storage.load();
      expect(result.lastUpdateCheckDate).toBe('2026-06-20');
      expect(result.needsHistoryReorganize).toBe(true);
    });

    it('fills missing fields with defaults', async () => {
      mockGetItem.mockResolvedValue(JSON.stringify({ lastUpdateCheckDate: '2026-06-20' }));
      const result = await storage.load();
      expect(result.lastUpdateCheckDate).toBe('2026-06-20');
      expect(result.needsHistoryReorganize).toBe(false);
    });

    it('returns defaults on parse error', async () => {
      mockGetItem.mockResolvedValue('not-json');
      const result = await storage.load();
      expect(result).toEqual(RUNTIME_STATE_DEFAULTS);
    });
  });

  describe('save', () => {
    it('persists state to AsyncStorage', async () => {
      await storage.save({ lastUpdateCheckDate: '2026-06-21', needsHistoryReorganize: false });
      expect(mockSetItem).toHaveBeenCalledWith(
        RUNTIME_STATE_KEY,
        JSON.stringify({ lastUpdateCheckDate: '2026-06-21', needsHistoryReorganize: false })
      );
    });
  });

  describe('update', () => {
    it('merges partial updates with existing state', async () => {
      mockGetItem.mockResolvedValue(
        JSON.stringify({ lastUpdateCheckDate: '2026-06-20', needsHistoryReorganize: false })
      );
      await storage.update({ needsHistoryReorganize: true });
      expect(mockSetItem).toHaveBeenCalledWith(
        RUNTIME_STATE_KEY,
        JSON.stringify({ lastUpdateCheckDate: '2026-06-20', needsHistoryReorganize: true })
      );
    });
  });
});
