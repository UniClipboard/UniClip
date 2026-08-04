import React from 'react';
import {
  Button,
  CircularProgressIndicator,
  Column,
  Host,
  Icon,
  IconButton,
  LazyColumn,
  ListItem,
  ModalBottomSheet,
  OutlinedButton,
  Row,
  Spacer,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  animateContentSize,
  fillMaxWidth,
  height,
  padding,
  weight,
  width,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/useTheme';
import type { UnifiedSpaceDevice } from '@/features/space';
import type { MySpaceSheetProps } from './MySpaceSheet.types';
import { useMySpaceSheet } from './useMySpaceSheet';

const ICONS = {
  add: require('../assets/icons/add.xml'),
  copy: require('../assets/icons/content_copy.xml'),
  device: require('../assets/icons/account_circle.xml'),
  empty: require('../assets/icons/groups.xml'),
  error: require('../assets/icons/info.xml'),
  paired: require('../assets/icons/check_circle.xml'),
  share: require('../assets/icons/share.xml'),
  status: require('../assets/icons/circle.xml'),
};

const TITLE_STYLE = { fontSize: 20, fontWeight: '600' } as const;
const INVITATION_STYLE = { typography: 'headlineLarge' } as const;

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
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const {
    devices,
    isLoading,
    refreshFailed,
    refresh,
    invitation,
    invitationPending,
    invitationError,
    invitationCopied,
    invitationExpired,
    invitationTimeRemaining,
    pairedDeviceName,
    issueInvitation,
    copyInvitation,
    shareInvitation,
  } = useMySpaceSheet(visible);
  const invitationHeight = invitation ? 248 : invitationError ? 72 : 0;
  const pairedHeight = pairedDeviceName ? 72 : 0;
  const listHeight = Math.min(
    Math.max(devices.length * 72 + invitationHeight + pairedHeight + 72, 216),
    520
  );

  return (
    <ModalBottomSheet onDismissRequest={onClose}>
      <Column modifiers={[fillMaxWidth(), animateContentSize()]}>
        <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(24, 0, 12, 8)]}>
          <ComposeText style={TITLE_STYLE}>{t('topBar.mySpace', { ns: 'home' })}</ComposeText>
          <Spacer modifiers={[weight(1)]} />
          <ComposeText color={colors.onSurfaceVariant}>{devices.length}</ComposeText>
          <IconButton onClick={() => void issueInvitation()} enabled={!invitationPending}>
            {invitationPending ? (
              <CircularProgressIndicator modifiers={[width(24), height(24)]} />
            ) : (
              <Icon
                source={ICONS.add}
                size={24}
                tint={colors.primary}
                contentDescription={t('space.invitation.addA11y', { ns: 'settingsSync' })}
              />
            )}
          </IconButton>
        </Row>

        <LazyColumn
          contentPadding={{ start: 12, end: 12, bottom: 20 }}
          modifiers={[fillMaxWidth(), height(listHeight)]}
        >
          {pairedDeviceName ? (
            <ListItem>
              <ListItem.LeadingContent>
                <Icon source={ICONS.paired} size={24} tint={colors.primary} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                <ComposeText>{t('space.flow.successTitle')}</ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.SupportingContent>
                <ComposeText color={colors.onSurfaceVariant}>
                  {t('space.invitation.pairedDevice', { device: pairedDeviceName })}
                </ComposeText>
              </ListItem.SupportingContent>
            </ListItem>
          ) : null}

          {invitationError ? (
            <ListItem>
              <ListItem.LeadingContent>
                <Icon source={ICONS.error} size={22} tint={colors.error} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                <ComposeText color={colors.error}>{invitationError}</ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.TrailingContent>
                <TextButton onClick={() => void issueInvitation()}>
                  <ComposeText>{t('action.retry', { ns: 'common' })}</ComposeText>
                </TextButton>
              </ListItem.TrailingContent>
            </ListItem>
          ) : null}

          {invitation ? (
            <>
              <ListItem>
                <ListItem.LeadingContent>
                  <Icon source={ICONS.empty} size={24} tint={colors.primary} />
                </ListItem.LeadingContent>
                <ListItem.HeadlineContent>
                  <ComposeText style={INVITATION_STYLE}>{invitation.invitationCode}</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <Column>
                    <ComposeText color={colors.onSurfaceVariant}>
                      {t('space.invitation.pairingInstructions')}
                    </ComposeText>
                    <ComposeText color={invitationExpired ? colors.error : colors.onSurfaceVariant}>
                      {invitationExpired
                        ? t('space.flow.expired')
                        : t('space.flow.expiresIn', { time: invitationTimeRemaining })}
                    </ComposeText>
                    <ComposeText color={colors.onSurfaceVariant}>
                      {t(
                        invitation.availability === 'sameLocalNetwork'
                          ? 'space.invitation.sameLocalNetwork'
                          : 'space.invitation.crossNetwork'
                      )}
                    </ComposeText>
                  </Column>
                </ListItem.SupportingContent>
              </ListItem>
              {invitationExpired ? (
                <Button
                  onClick={() => void issueInvitation()}
                  enabled={!invitationPending}
                  modifiers={[fillMaxWidth(), padding(16, 0, 16, 8)]}
                >
                  <ComposeText>{t('space.invitation.action')}</ComposeText>
                </Button>
              ) : (
                <Row modifiers={[fillMaxWidth(), padding(16, 0, 16, 8)]}>
                  <OutlinedButton onClick={() => void copyInvitation()} modifiers={[weight(1)]}>
                    <Icon
                      source={invitationCopied ? ICONS.paired : ICONS.copy}
                      size={18}
                      tint={colors.primary}
                    />
                    <Spacer modifiers={[width(6)]} />
                    <ComposeText>{t('space.flow.copyInvitation')}</ComposeText>
                  </OutlinedButton>
                  <Spacer modifiers={[width(8)]} />
                  <Button onClick={() => void shareInvitation()} modifiers={[weight(1)]}>
                    <Icon source={ICONS.share} size={18} tint={colors.onPrimary} />
                    <Spacer modifiers={[width(6)]} />
                    <ComposeText>{t('space.flow.shareInvitation')}</ComposeText>
                  </Button>
                </Row>
              )}
            </>
          ) : null}

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
