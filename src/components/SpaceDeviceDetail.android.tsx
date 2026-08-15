import {
  AlertDialog,
  Button,
  CircularProgressIndicator,
  Column,
  Host,
  Icon,
  ListItem,
  ModalBottomSheet,
  Spacer,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth, height, padding, width } from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/useTheme';
import type { DeviceTrustDeviceView } from '@/features/space';
import type { SpaceDeviceDetailProps } from './SpaceDeviceDetail.types';

const ICONS = {
  device: require('../assets/icons/account_circle.xml'),
  info: require('../assets/icons/info.xml'),
};
const DEVICE_TITLE_STYLE = { typography: 'titleLarge' } as const;

function factValue(
  device: DeviceTrustDeviceView,
  fact: 'reachability' | 'groupRelationship' | 'syncRelationship' | 'compatibility'
): string {
  return device[fact];
}

function DeviceDetailContent(props: SpaceDeviceDetailProps) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const device = props.device;
  if (!device) return null;

  const facts = ['reachability', 'groupRelationship', 'syncRelationship', 'compatibility'] as const;

  return (
    <>
      <ModalBottomSheet
        onDismissRequest={props.removing ? () => undefined : props.onClose}
        initialFullyExpanded
      >
        <Column modifiers={[fillMaxWidth(), padding(12, 0, 12, 24)]}>
          <ListItem>
            <ListItem.LeadingContent>
              <Icon source={ICONS.device} size={36} tint={colors.primary} />
            </ListItem.LeadingContent>
            <ListItem.HeadlineContent>
              <ComposeText style={DEVICE_TITLE_STYLE}>{device.displayName}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText color={colors.onSurfaceVariant}>
                {t(`space.deviceTrust.status.${device.primaryStatus}`)}
              </ComposeText>
            </ListItem.SupportingContent>
          </ListItem>

          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('space.deviceDetail.identity.label')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.TrailingContent>
              <ComposeText color={colors.onSurfaceVariant}>
                {t(`space.deviceDetail.identity.${device.isLocal ? 'local' : 'remote'}`)}
              </ComposeText>
            </ListItem.TrailingContent>
          </ListItem>

          {facts.map((fact) => (
            <ListItem key={fact}>
              <ListItem.HeadlineContent>
                <ComposeText>{t(`space.deviceDetail.${fact}.label`)}</ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.TrailingContent>
                <ComposeText color={colors.onSurfaceVariant}>
                  {t(`space.deviceDetail.${fact}.${factValue(device, fact)}`)}
                </ComposeText>
              </ListItem.TrailingContent>
            </ListItem>
          ))}

          {device.blockedReason !== null ? (
            <ListItem>
              <ListItem.LeadingContent>
                <Icon source={ICONS.info} size={20} tint={colors.error} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                <ComposeText color={colors.error}>
                  {t(`space.deviceDetail.blockedReason.${device.blockedReason}`)}
                </ComposeText>
              </ListItem.HeadlineContent>
            </ListItem>
          ) : null}

          {props.removeErrorMessage ? (
            <ListItem>
              <ListItem.LeadingContent>
                <Icon source={ICONS.info} size={20} tint={colors.error} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                <ComposeText color={colors.error}>{props.removeErrorMessage}</ComposeText>
              </ListItem.HeadlineContent>
            </ListItem>
          ) : null}

          {device.canUpdateThisDevice && props.onUpdateThisDevice ? (
            <Button onClick={props.onUpdateThisDevice} modifiers={[fillMaxWidth()]}>
              <ComposeText>{t('space.deviceDetail.updateAction')}</ComposeText>
            </Button>
          ) : null}

          {props.canRemove ? (
            <Button
              onClick={props.onRequestRemove}
              enabled={!props.removing}
              colors={{ containerColor: colors.error, contentColor: colors.onError }}
              modifiers={[fillMaxWidth()]}
            >
              {props.removing ? (
                <CircularProgressIndicator modifiers={[width(20), height(20)]} />
              ) : (
                <ComposeText>{t('space.devices.remove')}</ComposeText>
              )}
            </Button>
          ) : null}
          <Spacer modifiers={[height(12)]} />
        </Column>
      </ModalBottomSheet>

      {props.confirmingRemoval ? (
        <AlertDialog onDismissRequest={props.removing ? () => undefined : props.onCancelRemove}>
          <AlertDialog.Title>
            <ComposeText>{t('space.devices.remove')}</ComposeText>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <ComposeText>
              {t('space.devices.removeConfirmNamed', { device: device.displayName })}
            </ComposeText>
          </AlertDialog.Text>
          <AlertDialog.ConfirmButton>
            <TextButton onClick={props.onConfirmRemove} enabled={!props.removing}>
              <ComposeText color={colors.error}>{t('space.devices.remove')}</ComposeText>
            </TextButton>
          </AlertDialog.ConfirmButton>
          <AlertDialog.DismissButton>
            <TextButton onClick={props.onCancelRemove} enabled={!props.removing}>
              <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
            </TextButton>
          </AlertDialog.DismissButton>
        </AlertDialog>
      ) : null}
    </>
  );
}

export function SpaceDeviceDetail(props: SpaceDeviceDetailProps) {
  const { theme } = useTheme();
  if (!props.device) return null;
  return (
    <Host
      colorScheme={theme.isDark ? 'dark' : 'light'}
      seedColor={theme.colors.accent}
      matchContents
    >
      <DeviceDetailContent {...props} />
    </Host>
  );
}
