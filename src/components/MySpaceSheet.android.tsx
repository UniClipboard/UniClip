import React from 'react';
import {
  CircularProgressIndicator,
  Column,
  Host,
  Icon,
  IconButton,
  LazyColumn,
  ListItem,
  ModalBottomSheet,
  Row,
  Spacer,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth, height, padding, weight, width } from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/useTheme';
import type { UnifiedSpaceDevice } from '@/stores/unifiedSpaceStore';
import type { MySpaceSheetProps } from './MySpaceSheet.types';
import { useMySpaceSheet } from './useMySpaceSheet';

const ICONS = {
  close: require('../assets/icons/close.xml'),
  device: require('../assets/icons/account_circle.xml'),
  empty: require('../assets/icons/groups.xml'),
  error: require('../assets/icons/info.xml'),
  status: require('../assets/icons/circle.xml'),
};

const TITLE_STYLE = { fontSize: 20, fontWeight: '600' } as const;

function SpaceDeviceRow({ device }: { device: UnifiedSpaceDevice }) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const online = device.isLocal || device.online;
  const statusColor = online ? colors.primary : colors.outline;

  return (
    <ListItem>
      <ListItem.LeadingContent>
        <Icon source={ICONS.device} size={30} tint={colors.primary} />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText>{device.displayName}</ComposeText>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <Row verticalAlignment="center">
          <Icon source={ICONS.status} size={8} tint={statusColor} />
          <Spacer modifiers={[width(6)]} />
          <ComposeText color={statusColor}>
            {t(online ? 'space.devices.online' : 'space.devices.offline')}
          </ComposeText>
        </Row>
      </ListItem.SupportingContent>
    </ListItem>
  );
}

function MySpaceSheetContent({ visible, onClose }: MySpaceSheetProps) {
  const { t } = useTranslation(['home', 'settingsSync']);
  const colors = useMaterialColors();
  const { devices, isLoading, refreshFailed, refresh } = useMySpaceSheet(visible);
  const listHeight = Math.min(Math.max(devices.length * 72 + 72, 144), 432);

  return (
    <ModalBottomSheet onDismissRequest={onClose}>
      <Column modifiers={[fillMaxWidth()]}>
        <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(24, 0, 12, 8)]}>
          <ComposeText style={TITLE_STYLE}>{t('topBar.mySpace', { ns: 'home' })}</ComposeText>
          <Spacer modifiers={[weight(1)]} />
          <ComposeText color={colors.onSurfaceVariant}>{devices.length}</ComposeText>
          <IconButton onClick={onClose}>
            <Icon
              source={ICONS.close}
              size={22}
              tint={colors.onSurfaceVariant}
              contentDescription={t('action.close', { ns: 'common' })}
            />
          </IconButton>
        </Row>

        <LazyColumn
          contentPadding={{ start: 12, end: 12, bottom: 20 }}
          modifiers={[fillMaxWidth(), height(listHeight)]}
        >
          {isLoading ? (
            <ListItem>
              <ListItem.LeadingContent>
                <CircularProgressIndicator modifiers={[width(24), height(24)]} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                <ComposeText color={colors.onSurfaceVariant}>
                  {t('state.loading', { ns: 'common' })}
                </ComposeText>
              </ListItem.HeadlineContent>
            </ListItem>
          ) : null}

          {refreshFailed ? (
            <ListItem>
              <ListItem.LeadingContent>
                <Icon source={ICONS.error} size={22} tint={colors.error} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                <ComposeText color={colors.error}>
                  {t('space.error.operationFailed', { ns: 'settingsSync' })}
                </ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.TrailingContent>
                <TextButton onClick={() => void refresh()}>
                  <ComposeText>{t('action.retry', { ns: 'common' })}</ComposeText>
                </TextButton>
              </ListItem.TrailingContent>
            </ListItem>
          ) : null}

          {!isLoading && devices.length === 0 ? (
            <ListItem>
              <ListItem.LeadingContent>
                <Icon source={ICONS.empty} size={24} tint={colors.outline} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                <ComposeText color={colors.onSurfaceVariant}>
                  {t('space.devices.empty', { ns: 'settingsSync' })}
                </ComposeText>
              </ListItem.HeadlineContent>
            </ListItem>
          ) : null}

          {devices.map((device) => (
            <SpaceDeviceRow key={device.deviceId} device={device} />
          ))}
        </LazyColumn>
      </Column>
    </ModalBottomSheet>
  );
}

export function MySpaceSheet(props: MySpaceSheetProps) {
  const { theme } = useTheme();

  if (!props.visible) return null;

  return (
    <Host colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.colors.accent}>
      <MySpaceSheetContent {...props} />
    </Host>
  );
}
