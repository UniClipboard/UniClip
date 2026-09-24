import type { ReactNode } from 'react';
import { Column, ModalBottomSheet, Text, useMaterialColors } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, paddingAll, verticalScroll } from '@expo/ui/jetpack-compose/modifiers';
import { AppButton } from '@/components/ui';

interface SettingsConfirmationSheetProps {
  visible: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  isConfirming?: boolean;
  testID?: string;
  onDismiss: () => void;
  onConfirm: () => void | Promise<void>;
}

const TITLE_STYLE = { typography: 'headlineSmall' } as const;

/** Compose overlay for settings hosted in a LazyColumn; owns full-width actions. */
export function SettingsConfirmationSheet({
  visible,
  title,
  children,
  confirmLabel,
  cancelLabel,
  isConfirming = false,
  testID,
  onDismiss,
  onConfirm,
}: SettingsConfirmationSheetProps) {
  const colors = useMaterialColors();
  if (!visible) return null;

  return (
    <ModalBottomSheet
      skipPartiallyExpanded
      onDismissRequest={isConfirming ? () => {} : onDismiss}
      properties={{
        shouldDismissOnBackPress: !isConfirming,
        shouldDismissOnClickOutside: !isConfirming,
      }}
      sheetGesturesEnabled={!isConfirming}
    >
      <Column
        verticalArrangement={{ spacedBy: 16 }}
        modifiers={[fillMaxWidth(), paddingAll(24), verticalScroll()]}
      >
        <Text color={colors.onSurface} style={TITLE_STYLE}>
          {title}
        </Text>
        {children}
        <AppButton
          testID={testID ? `${testID}-confirm` : undefined}
          title={confirmLabel}
          onPress={() => void onConfirm()}
          fullWidth
          size="large"
          disabled={isConfirming}
        />
        <AppButton
          testID={testID ? `${testID}-cancel` : undefined}
          title={cancelLabel}
          onPress={onDismiss}
          variant="text"
          fullWidth
          disabled={isConfirming}
        />
      </Column>
    </ModalBottomSheet>
  );
}
