jest.mock('expo-media-library', () => ({
  Asset: { create: jest.fn() },
  requestPermissionsAsync: jest.fn(),
}));

jest.mock('document-exporter', () => ({
  exportFile: jest.fn(),
  saveImageToPhotoLibrary: jest.fn(),
}));

import * as MediaLibrary from 'expo-media-library';
import { saveToGallery } from '../utils/fileActions.shared';
import { saveToGallery as saveToGalleryIos } from '../utils/fileActions.ios';

const mockCreateAsset = jest.mocked(MediaLibrary.Asset.create);
const mockRequestPermissions = jest.mocked(MediaLibrary.requestPermissionsAsync);
const mockSaveImageToPhotoLibrary = (
  jest.requireMock('document-exporter') as { saveImageToPhotoLibrary: jest.Mock }
).saveImageToPhotoLibrary;

describe('saveToGallery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestPermissions.mockResolvedValue({
      status: 'granted' as MediaLibrary.PermissionResponse['status'],
      granted: true,
      expires: 'never',
      canAskAgain: true,
      accessPrivileges: 'all',
    });
    mockCreateAsset.mockResolvedValue({
      id: 'asset-1',
    } as unknown as InstanceType<typeof MediaLibrary.Asset>);
    mockSaveImageToPhotoLibrary.mockResolvedValue(undefined);
  });

  it('uses the Expo 56 Asset API with write-only photo permission on Android', async () => {
    await saveToGallery('file:///cache/photo.png');

    expect(mockRequestPermissions).toHaveBeenCalledWith(true, ['photo']);
    expect(mockCreateAsset).toHaveBeenCalledWith('file:///cache/photo.png');
  });

  it('passes an extensionless App Group image directly to the iOS PhotoKit exporter', async () => {
    const sourceUri = 'file:///group/payloads/Image-ABCDEF';

    await saveToGalleryIos(sourceUri, 'photo.jpg');

    expect(mockRequestPermissions).toHaveBeenCalledWith(true, ['photo']);
    expect(mockSaveImageToPhotoLibrary).toHaveBeenCalledWith(sourceUri, 'photo.jpg');
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });

  it('does not invoke a gallery writer when photo permission is denied', async () => {
    mockRequestPermissions.mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      expires: 'never',
      canAskAgain: false,
      accessPrivileges: 'none',
    });

    await expect(saveToGalleryIos('file:///cache/photo.png', 'photo.png')).rejects.toThrow(
      'Media library permission denied'
    );

    expect(mockSaveImageToPhotoLibrary).not.toHaveBeenCalled();
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });

  it('propagates errors from the iOS PhotoKit exporter', async () => {
    mockSaveImageToPhotoLibrary.mockRejectedValueOnce(
      Object.assign(new Error('Photo library write failed'), { code: 'ERR_PHOTO_SAVE' })
    );

    await expect(saveToGalleryIos('file:///cache/photo.png', 'photo.png')).rejects.toMatchObject({
      code: 'ERR_PHOTO_SAVE',
    });
  });

  it('rejects the undocumented prm extension before requesting permission', async () => {
    await expect(saveToGallery('file:///cache/photo.prm')).rejects.toThrow();

    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });
});
