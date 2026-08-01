import { Platform } from 'react-native';
import { requestPinUploadShortcut, isShortcutModuleAvailable } from 'shortcut';
import { log } from './Logger';

export const ShortcutService = {
  addUploadShortcut(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return Promise.reject(new Error('Home-screen shortcuts are only supported on Android'));
    }
    if (!isShortcutModuleAvailable) {
      return Promise.reject(new Error('ShortcutModule is not available'));
    }
    return requestPinUploadShortcut().catch((error) => {
      log.error('ShortcutModule addUploadShortcut error:', error);
      throw error;
    });
  },
};
