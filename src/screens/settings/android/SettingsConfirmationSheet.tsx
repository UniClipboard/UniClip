import type { ReactNode } from 'react';
import { Column, ModalBottomSheet, Text, useMaterialColors } from '@expo/ui/jetpack-compose';
import {
  fillMaxSize,
  fillMaxWidth,
  padding,
  paddingAll,
  verticalScroll,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import { AppButton } from '@/components/ui';

interface SettingsConfirmationSheetProps {
  visible: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  isConfirming?: boolean;
  testID?: string;
  /** Style of the secondary action; defaults to a text button. */
  cancelVariant?: 'text' | 'outlined';
  /**
   * Long-form body (e.g. release notes). The sheet opens full height with a fixed title and
   * fixed actions, and only the body scrolls, so the actions can never be pushed off screen.
   */
  scrollableBody?: boolean;
  onDismiss: () => void;
  /** Secondary action; defaults to `onDismiss` (a plain cancel). */
  onCancel?: () => void;
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
  cancelVariant = 'text',
  scrollableBody = false,
  onDismiss,
  onCancel,
  onConfirm,
}: SettingsConfirmationSheetProps) {
  const colors = useMaterialColors();
  if (!visible) return null;

  const titleText = (
    <Text color={colors.onSurface} style={TITLE_STYLE}>
      {title}
    </Text>
  );
  const actions = (
    <>
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
        onPress={onCancel ?? onDismiss}
        variant={cancelVariant}
        fullWidth
        disabled={isConfirming}
      />
    </>
  );

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
      {scrollableBody ? (
        <Column modifiers={[fillMaxSize()]}>
          <Column modifiers={[fillMaxWidth(), padding(24, 8, 24, 16)]}>{titleText}</Column>
          <Column
            verticalArrangement={{ spacedBy: 16 }}
            modifiers={[fillMaxWidth(), weight(1), verticalScroll(), padding(24, 0, 24, 0)]}
          >
            {children}
          </Column>
          <Column
            verticalArrangement={{ spacedBy: 16 }}
            modifiers={[fillMaxWidth(), padding(24, 16, 24, 24)]}
          >
            {actions}
          </Column>
        </Column>
      ) : (
        <Column
          verticalArrangement={{ spacedBy: 16 }}
          modifiers={[fillMaxWidth(), paddingAll(24), verticalScroll()]}
        >
          {titleText}
          {children}
          {actions}
        </Column>
      )}
    </ModalBottomSheet>
  );
}
