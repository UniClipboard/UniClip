import { scanQRCode } from 'qr-scanner';
import { Camera } from 'expo-camera';
import { parseLanConnectUri } from './connectUri';

export async function scanLanConnection(cancelLabel: string, hint: string) {
  const permission = await Camera.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('CameraPermissionDenied');
  const raw = await scanQRCode(cancelLabel, hint);
  if (raw === null) return null;
  const parsed = parseLanConnectUri(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}
