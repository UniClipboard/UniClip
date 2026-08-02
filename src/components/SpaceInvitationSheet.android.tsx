import {
  Button,
  CircularProgressIndicator,
  Column,
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

import { useMySpaceSheet } from './useMySpaceSheet';
import type { SpaceInvitationSheetProps } from './SpaceInvitationSheet.types';

const ICONS = {
  close: require('../assets/icons/close.xml'),
  copy: require('../assets/icons/content_copy.xml'),
  error: require('../assets/icons/info.xml'),
  paired: require('../assets/icons/check_circle.xml'),
  share: require('../assets/icons/share.xml'),
  space: require('../assets/icons/groups.xml'),
};

const TITLE_STYLE = { fontSize: 20, fontWeight: '600' } as const;
const INVITATION_STYLE = {
  typography: 'headlineLarge',
  fontFamily: 'monospace',
  letterSpacing: 0,
} as const;

export function SpaceInvitationSheet({ visible, onClose }: SpaceInvitationSheetProps) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const {
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
  } = useMySpaceSheet(visible, { issueOnOpen: true });

  if (!visible) return null;

  const contentHeight = invitation ? 388 : pairedDeviceName ? 240 : 200;

  return (
    <ModalBottomSheet onDismissRequest={onClose}>
      <Column modifiers={[fillMaxWidth(), animateContentSize()]}>
        <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(24, 8, 16, 8)]}>
          <ComposeText style={TITLE_STYLE}>{t('space.invitation.title')}</ComposeText>
          <Spacer modifiers={[weight(1)]} />
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
          contentPadding={{ start: 16, end: 16, bottom: 24 }}
          modifiers={[fillMaxWidth(), height(contentHeight)]}
        >
          {invitationPending && !invitation ? (
            <ListItem>
              <ListItem.LeadingContent>
                <CircularProgressIndicator modifiers={[width(24), height(24)]} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                <ComposeText>{t('space.working')}</ComposeText>
              </ListItem.HeadlineContent>
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

          {pairedDeviceName ? (
            <>
              <ListItem>
                <ListItem.LeadingContent>
                  <Icon source={ICONS.paired} size={30} tint={colors.primary} />
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
              <Button onClick={onClose} modifiers={[fillMaxWidth(), padding(16, 8, 16, 8)]}>
                <ComposeText>{t('action.done', { ns: 'common' })}</ComposeText>
              </Button>
            </>
          ) : null}

          {invitation ? (
            <>
              <ListItem>
                <ListItem.LeadingContent>
                  <Icon source={ICONS.space} size={26} tint={colors.primary} />
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
                  modifiers={[fillMaxWidth(), padding(16, 8, 16, 8)]}
                >
                  <ComposeText>{t('space.invitation.action')}</ComposeText>
                </Button>
              ) : (
                <Row modifiers={[fillMaxWidth(), padding(16, 8, 16, 8)]}>
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
        </LazyColumn>
      </Column>
    </ModalBottomSheet>
  );
}
