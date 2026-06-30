import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLiveUrl, saveLiveUrl } from 'app-group-store';
import {
  loadServerRouteLiveUrl,
  saveServerRouteLiveUrl,
} from '@/services/serverRouteRecordStore';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;
const mockGetLiveUrl = getLiveUrl as jest.Mock;
const mockSaveLiveUrl = saveLiveUrl as jest.Mock;

describe('serverRouteRecordStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
    mockRemoveItem.mockResolvedValue(undefined);
    mockGetLiveUrl.mockResolvedValue(null);
    mockSaveLiveUrl.mockResolvedValue(undefined);
  });

  it('stores the live server address in main-app storage and mirrors it for extensions', async () => {
    await saveServerRouteLiveUrl('https://clip.example.com', 'http://192.168.1.20:5033');

    expect(mockSetItem).toHaveBeenCalledWith(
      '@server-route:live-url:https%3A%2F%2Fclip.example.com',
      'http://192.168.1.20:5033'
    );
    expect(mockSaveLiveUrl).toHaveBeenCalledWith(
      'https://clip.example.com',
      'http://192.168.1.20:5033'
    );
  });

  it('uses the main-app record before falling back to extension storage', async () => {
    mockGetItem.mockResolvedValue('http://192.168.1.20:5033');

    await expect(loadServerRouteLiveUrl('https://clip.example.com')).resolves.toBe(
      'http://192.168.1.20:5033'
    );
    expect(mockGetLiveUrl).not.toHaveBeenCalled();
  });

  it('falls back to extension storage and copies the value into main-app storage', async () => {
    mockGetLiveUrl.mockResolvedValue('https://clip.example.com');

    await expect(loadServerRouteLiveUrl('https://clip.example.com')).resolves.toBe(
      'https://clip.example.com'
    );
    expect(mockSetItem).toHaveBeenCalledWith(
      '@server-route:live-url:https%3A%2F%2Fclip.example.com',
      'https://clip.example.com'
    );
  });

  it('clears the main-app record and extension mirror when every address fails', async () => {
    await saveServerRouteLiveUrl('https://clip.example.com', null);

    expect(mockRemoveItem).toHaveBeenCalledWith(
      '@server-route:live-url:https%3A%2F%2Fclip.example.com'
    );
    expect(mockSaveLiveUrl).toHaveBeenCalledWith('https://clip.example.com', null);
  });
});
