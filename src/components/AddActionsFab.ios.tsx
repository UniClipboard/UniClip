import { useCallback, useMemo } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button as SwiftUIButton, Divider, Host, Menu } from '@expo/ui/swift-ui';
import { Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { GlassContainer } from '@/components/ui';
import { iosAccent } from '@/theme/iosDesignTokens';
import { FAB_SIZE, type AddActionsFabProps } from './AddActionsFab.types';

/**
 * iOS 使用 SwiftUI Menu 承载 FAB 操作，菜单呈现、交互反馈与收起均由系统管理。
 */
export function AddActionsFab({
  onOpenChange,
  onTakePhoto,
  onPickImage,
  onPickFile,
  onUploadClipboard,
  onSync,
  anchor = 'end',
  horizontalInset = 16,
}: AddActionsFabProps) {
  const { t } = useTranslation('home');
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const hostStyle = useMemo(
    () => [
      styles.host,
      anchor === 'end' ? { right: horizontalInset } : { left: horizontalInset },
      { bottom: insets.bottom + 12 },
    ],
    [anchor, horizontalInset, insets.bottom]
  );

  const runItem = useCallback(
    (action: () => void) => {
      Haptics.selectionAsync().catch(() => {});
      onOpenChange(false);
      // 等系统菜单完成 dismiss，再 present 相机或 picker。
      setTimeout(action, 350);
    },
    [onOpenChange]
  );

  return (
    <Host ignoreSafeArea="all" style={hostStyle}>
      <Menu
        label={
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={t('a11y.addContent')}
            style={styles.trigger}
          >
            <GlassContainer shape="circle" interactive style={styles.glass}>
              <Plus size={28} color={isDark ? iosAccent.dark : iosAccent.light} />
            </GlassContainer>
          </View>
        }
      >
        <SwiftUIButton
          label={t('fab.takePhoto')}
          systemImage="camera"
          onPress={() => runItem(onTakePhoto)}
        />
        <SwiftUIButton
          label={t('fab.pickImage')}
          systemImage="photo.on.rectangle"
          onPress={() => runItem(onPickImage)}
        />
        <SwiftUIButton
          label={t('fab.pickFile')}
          systemImage="doc"
          onPress={() => runItem(onPickFile)}
        />
        <SwiftUIButton
          label={t('fab.uploadClipboard')}
          systemImage="doc.on.clipboard"
          onPress={() => runItem(onUploadClipboard)}
        />
        <Divider />
        <SwiftUIButton
          label={t('fab.syncNow')}
          systemImage="arrow.triangle.2.circlepath"
          onPress={() => runItem(onSync)}
        />
      </Menu>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    zIndex: 20,
  },
  trigger: {
    width: FAB_SIZE,
    height: FAB_SIZE,
  },
  glass: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
