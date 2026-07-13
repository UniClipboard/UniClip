import type { ColorValue } from 'react-native';
import type { HomeController } from '@/screens/useHomeController';

export interface ClipboardDetailModalProps {
  visible: boolean;
  onDismiss: () => void;
  c: HomeController;
  containerColor?: ColorValue;
}
