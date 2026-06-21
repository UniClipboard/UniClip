import { Platform, ToastAndroid } from 'react-native';

export function showToast(message: string, duration: 'short' | 'long' = 'short'): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(
      message,
      duration === 'short' ? ToastAndroid.SHORT : ToastAndroid.LONG
    );
  }
}
