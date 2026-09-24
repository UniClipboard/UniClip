/**
 * 空间设置二级页(Android):自定义中继、切换空间、退出空间。
 *
 * 这些是低频管理项,从顶级「设备」目的地下沉到这里,设备页只保留一行入口,让设备列表成为
 * 页面主体。整页作为 LazyColumn 的单个 item(单个 Column),弹窗与操作状态随页面稳定持有。
 */
import { memo, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import {
  AlertDialog,
  CircularProgressIndicator,
  Column,
  Icon,
  ListItem,
  Spacer,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  fillMaxWidth,
  height as heightModifier,
  padding,
  testID,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import { useSpaceDeviceManagement } from '@/components/useSpaceDeviceManagement';
import { getUnifiedSpaceService, UnifiedSpaceInputError } from '@/features/space';
import { CustomRelaySection } from '../CustomRelaySection';
import { SettingsSectionItem, useSettingsSectionRowColors } from '../SettingsSectionItem';
import { SettingsLeadingIcon } from './SettingsLeadingIcon';

const ICONS = {
  chevron: require('../../../assets/icons/chevron_right.xml'),
  leave: require('../../../assets/icons/delete.xml'),
  space: require('../../../assets/icons/groups.xml'),
};

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

function SwitchSpaceRow({ enabled, onSwitch }: { enabled: boolean; onSwitch: () => void }) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const rowColors = useSettingsSectionRowColors();
  return (
    <ListItem
      colors={rowColors}
      modifiers={enabled ? [testID('space-switch'), clickable(onSwitch)] : [testID('space-switch')]}
    >
      <ListItem.LeadingContent>
        <SettingsLeadingIcon source={ICONS.space} tone={enabled ? 'primary' : 'muted'} />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText color={enabled ? undefined : colors.onSurfaceVariant}>
          {t('space.switch.title')}
        </ComposeText>
      </ListItem.HeadlineContent>
      <ListItem.TrailingContent>
        <Icon source={ICONS.chevron} size={20} tint={colors.onSurfaceVariant} />
      </ListItem.TrailingContent>
    </ListItem>
  );
}

function LeaveSpaceRow({
  enabled,
  leaving,
  onLeave,
}: {
  enabled: boolean;
  leaving: boolean;
  onLeave: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const rowColors = useSettingsSectionRowColors();
  return (
    <ListItem
      colors={rowColors}
      modifiers={enabled ? [testID('space-leave'), clickable(onLeave)] : [testID('space-leave')]}
    >
      <ListItem.LeadingContent>
        <SettingsLeadingIcon source={ICONS.leave} tone="error" />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText color={colors.error}>{t('space.leave.action')}</ComposeText>
      </ListItem.HeadlineContent>
      {leaving ? (
        <ListItem.TrailingContent>
          <CircularProgressIndicator modifiers={[widthModifier(24), heightModifier(24)]} />
        </ListItem.TrailingContent>
      ) : null}
    </ListItem>
  );
}

export const SpaceSettingsSection = memo(function SpaceSettingsSection() {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const navigation = useNavigation();
  const deviceManagement = useSpaceDeviceManagement({ allowHighImpactActions: true });
  const [switching, setSwitching] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const highImpactActionsDisabled =
    !deviceManagement.highImpactActionsAvailable ||
    deviceManagement.operationInProgress ||
    deviceManagement.overview.hasPendingDecision;
  const leaveDisabled = leaving || deviceManagement.operationInProgress;

  // 退出进行中拦截返回键,避免中途离开页面导致状态不一致(与 iOS handleBack 对齐)
  useEffect(() => {
    if (!leaving) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [leaving]);

  const leaveSpace = async () => {
    if (leaveDisabled) return;
    setConfirmLeave(false);
    setLeaving(true);
    setLeaveError(null);
    try {
      await getUnifiedSpaceService().leaveSpace();
      // 已不在空间内,本页的管理项不再适用,回到设备页展示空状态
      if (navigation.canGoBack()) navigation.goBack();
    } catch (cause) {
      setLeaveError(operationError(cause, t));
    } finally {
      setLeaving(false);
    }
  };

  return (
    <Column modifiers={[fillMaxWidth()]}>
      <CustomRelaySection />

      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem
        variant="grouped"
        title={t('space.manage.title')}
        footer={
          highImpactActionsDisabled ? t('space.switch.unavailable') : t('space.switch.description')
        }
      >
        <SwitchSpaceRow enabled={!highImpactActionsDisabled} onSwitch={() => setSwitching(true)} />
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem
        variant="grouped"
        title={t('space.danger.title')}
        footer={t('space.leave.confirm')}
      >
        <LeaveSpaceRow
          enabled={!leaveDisabled}
          leaving={leaving}
          onLeave={() => setConfirmLeave(true)}
        />
      </SettingsSectionItem>
      {leaveError ? (
        <Column modifiers={[padding(16, 12, 16, 0)]}>
          <ComposeText color={colors.error}>{leaveError}</ComposeText>
        </Column>
      ) : null}
      {/* Dialogs follow the content so mounting one never resets the rows' Compose state. */}
      <AddSyncConnectionSheet
        visible={switching}
        initialMode="switch"
        onClose={() => setSwitching(false)}
        onConnected={() => {
          setSwitching(false);
          return true;
        }}
      />
      {confirmLeave ? (
        <AlertDialog onDismissRequest={() => setConfirmLeave(false)}>
          <AlertDialog.Title>
            <ComposeText>{t('space.leave.action')}</ComposeText>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <ComposeText>{t('space.leave.confirm')}</ComposeText>
          </AlertDialog.Text>
          <AlertDialog.ConfirmButton>
            <TextButton onClick={() => void leaveSpace()}>
              <ComposeText>{t('space.leave.action')}</ComposeText>
            </TextButton>
          </AlertDialog.ConfirmButton>
          <AlertDialog.DismissButton>
            <TextButton onClick={() => setConfirmLeave(false)}>
              <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
            </TextButton>
          </AlertDialog.DismissButton>
        </AlertDialog>
      ) : null}
    </Column>
  );
});
