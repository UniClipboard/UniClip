import { ModalBottomSheet } from '@expo/ui/jetpack-compose';
import type { ColorValue } from 'react-native';

export interface AppBottomSheetProps {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
  containerColor?: ColorValue;
}

export function AppBottomSheet({
  visible,
  onDismiss,
  children,
  containerColor,
}: AppBottomSheetProps) {
  if (!visible) return null;
  return (
    <ModalBottomSheet onDismissRequest={onDismiss} containerColor={containerColor}>
      {children}
    </ModalBottomSheet>
  );
}
