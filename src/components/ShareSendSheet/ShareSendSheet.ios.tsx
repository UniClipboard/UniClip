import React from 'react';
import { StyleSheet } from 'react-native';
import {
  BottomSheet,
  Button as SwiftUIButton,
  Group,
  Host,
  HStack,
  Image,
  ProgressView,
  Section,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  clipShape,
  clipped,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  controlSize,
  lineLimit,
  opacity,
  padding,
  presentationDetents,
  presentationDragIndicator,
  resizable,
  aspectRatio,
  shapes,
  accessibilityValue,
  listRowBackground,
  listRowInsets,
  interactiveDismissDisabled,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';
import { IosSheetForm, SheetHeader } from '@/components/ui';
import {
  iosProminentButtonModifiers,
  iosSecondaryButtonModifiers,
  iosSaturatedButtonPalette,
} from '@/components/ui/iosButtonStyles.ios';
import { iosColors, iosKindTints } from '@/theme/iosDesignTokens';
import type { ShareSendSheetProps } from './ShareSendSheet.types';
import {
  useShareSendController,
  formatBytes,
  type ShareJobView,
  type ShareTarget,
} from './useShareSendController';

const TERTIARY_LABEL = iosColors?.tertiaryLabel ?? '#8E8E93';
const IMAGE_PREVIEW_SIZE = 64;
const SELECTED_ROW_BACKGROUND = iosColors?.tertiarySystemFill ?? '#E5E5EA';
const SHEET_BACKGROUND = iosColors?.systemGroupedBackground ?? '#F2F2F7';

/**
 * iOS 分享弹层默认全屏展开，内容与设备列表由原生 Form 滚动。
 */
export function ShareSendSheet({ visible, onClose, jobs, embeddedInHost = false }: ShareSendSheetProps) {
  const { t } = useTranslation('share');
  const c = useShareSendController(onClose, visible, jobs);
  const sheet = (
    <BottomSheet
      isPresented={visible}
      onIsPresentedChange={(presented) => {
        if (!presented) c.handleClose();
      }}
    >
      <Group
        modifiers={[
          presentationDetents(['large']),
          presentationDragIndicator('visible'),
          interactiveDismissDisabled(c.isSending),
        ]}
      >
        <VStack
          spacing={0}
          modifiers={[
            frame({ maxWidth: Infinity, maxHeight: Infinity }),
            background(SHEET_BACKGROUND),
          ]}
        >
          <SheetHeader title={t('send.title')} />
          <Body c={c} />
        </VStack>
      </Group>
    </BottomSheet>
  );
  return embeddedInHost ? sheet : <Host style={styles.host}>{sheet}</Host>;
}

function Body({ c }: { c: ReturnType<typeof useShareSendController> }) {
  const { t } = useTranslation('share');

  if (c.phase.kind === 'claiming') {
    return (
      <VStack spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
        <ProgressView />
      </VStack>
    );
  }

  if (c.phase.kind === 'error') {
    return (
      <VStack spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
        <SwiftUIText modifiers={[foregroundStyle('secondary'), font({ size: 15 })]}>
          {c.phase.message}
        </SwiftUIText>
        <SwiftUIButton onPress={c.handleRetryClaim} modifiers={iosSecondaryButtonModifiers()}>
          <SwiftUIText>{t('send.retry')}</SwiftUIText>
        </SwiftUIButton>
      </VStack>
    );
  }

  if (c.jobViews.length === 0) {
    return (
      <VStack spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
        <Image systemName="tray" size={40} modifiers={[foregroundStyle('tertiary')]} />
        <SwiftUIText modifiers={[foregroundStyle('secondary'), font({ size: 15 })]}>
          {t('send.empty')}
        </SwiftUIText>
      </VStack>
    );
  }

  return (
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <IosSheetForm modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        <ContentSection views={c.jobViews} title={t('send.title')} />
        <TargetSection
          targets={c.targets}
          selectedTargetIds={c.selectedTargetIds}
          onToggle={c.toggleTarget}
          title={t(c.targetKind === 'server' ? 'send.servers' : 'send.devices')}
          emptyLabel={t(c.targetKind === 'server' ? 'send.noServers' : 'send.noDevices')}
          isLoading={c.isLoadingTargets}
        />
      </IosSheetForm>
      <SendFooter c={c} />
    </VStack>
  );
}

function SendFooter({ c }: { c: ReturnType<typeof useShareSendController> }) {
  const { t } = useTranslation('share');
  const hasFailed = c.jobViews.some((view) => view.sendState === 'failed');
  const successful = c.isDone && !hasFailed;
  const label = successful ? t('send.success') : hasFailed ? t('send.retry') : t('send.sendAll');
  const enabled = c.isDone || hasFailed || c.canSend;

  return (
    <SwiftUIButton
      onPress={c.isDone && !hasFailed ? c.handleClose : c.sendAll}
      modifiers={[
        ...iosProminentButtonModifiers(
          successful ? iosSaturatedButtonPalette(iosKindTints.image) : undefined,
          { fullWidth: true }
        ),
        controlSize('large'),
        disabled(!enabled || c.isSending),
        opacity(enabled && !c.isSending ? 1 : 0.38),
        padding({ horizontal: 20, top: 10, bottom: 16 }),
      ]}
    >
      <HStack spacing={8} modifiers={[frame({ minHeight: 48, maxWidth: Infinity })]}>
        <Spacer />
        {c.isSending ? <ProgressView /> : null}
        {successful ? <Image systemName="checkmark.circle.fill" size={18} color="#FFFFFF" /> : null}
        <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>{label}</SwiftUIText>
        <Spacer />
      </HStack>
    </SwiftUIButton>
  );
}

function ContentSection({ title, views }: { title: string; views: ShareJobView[] }) {
  return (
    <Section title={`${title} (${views.length})`}>
      {views.map((view) => (
        <JobRow key={view.job.id} view={view} />
      ))}
    </Section>
  );
}

function TargetSection({
  targets,
  selectedTargetIds,
  onToggle,
  title,
  emptyLabel,
  isLoading,
}: {
  targets: ShareTarget[];
  selectedTargetIds: Set<string>;
  onToggle: (targetId: string) => void;
  title: string;
  emptyLabel: string;
  isLoading: boolean;
}) {
  return (
    <Section title={title}>
      {isLoading ? (
        <ProgressView />
      ) : targets.length === 0 ? (
        <SwiftUIText
          modifiers={[foregroundStyle('secondary'), font({ size: 14 }), padding({ vertical: 8 })]}
        >
          {emptyLabel}
        </SwiftUIText>
      ) : (
        targets.map((target) => (
          <TargetRow
            key={target.id}
            target={target}
            selected={selectedTargetIds.has(target.id)}
            onToggle={onToggle}
          />
        ))
      )}
    </Section>
  );
}

function JobRow({ view }: { view: ShareJobView }) {
  const { job } = view;

  return (
    <HStack
      spacing={12}
      alignment="center"
      modifiers={[
        frame({ maxWidth: Infinity }),
        padding({ vertical: 4 }),
        listRowInsets({ top: 8, bottom: 8, leading: 16, trailing: 16 }),
      ]}
    >
      <JobLeading view={view} />
      <VStack alignment="leading" spacing={1} modifiers={[frame({ maxWidth: Infinity })]}>
        <SwiftUIText
          modifiers={[
            font({ size: 15, weight: 'medium' }),
            lineLimit(1),
            foregroundStyle('primary'),
          ]}
        >
          {job.kind === 'text' ? view.previewText || job.displayName : job.displayName}
        </SwiftUIText>
        <SwiftUIText modifiers={[font({ size: 12 }), lineLimit(1), foregroundStyle('secondary')]}>
          {job.kind === 'text'
            ? formatBytes(job.byteCount)
            : job.kind === 'image'
            ? `${job.mimeType ?? 'image'} · ${formatBytes(job.byteCount)}`
            : `${job.mimeType ?? ''}${job.mimeType ? ' · ' : ''}${formatBytes(job.byteCount)}`}
        </SwiftUIText>
      </VStack>
    </HStack>
  );
}

function JobLeading({ view }: { view: ShareJobView }) {
  const { job } = view;
  if (job.kind === 'image') {
    return (
      <Image
        uiImage={job.fileUri}
        modifiers={[
          resizable(),
          aspectRatio({ contentMode: 'fit' }),
          frame({ width: IMAGE_PREVIEW_SIZE, height: IMAGE_PREVIEW_SIZE }),
          clipped(),
          clipShape('roundedRectangle', 8),
        ]}
      />
    );
  }
  const isText = job.kind === 'text';
  const tint = isText ? iosKindTints.text : iosKindTints.file;
  return (
    <HStack alignment="center" modifiers={[frame({ width: 40, height: 40 })]}>
      <HStack
        alignment="center"
        modifiers={[
          frame({ width: 36, height: 36 }),
          background(`${tint}22`, shapes.roundedRectangle({ cornerRadius: 10 })),
        ]}
      >
        <Image systemName={isText ? 'doc.text.fill' : 'doc.fill'} size={18} color={tint} />
      </HStack>
    </HStack>
  );
}

function TargetRow({
  target,
  selected,
  onToggle,
}: {
  target: ShareTarget;
  selected: boolean;
  onToggle: (targetId: string) => void;
}) {
  return (
    <SwiftUIButton
      onPress={() => onToggle(target.id)}
      modifiers={[
        buttonStyle('plain'),
        accessibilityValue(selected ? 'selected' : 'not selected'),
        ...(selected ? [listRowBackground(SELECTED_ROW_BACKGROUND)] : []),
      ]}
    >
      <HStack
        spacing={10}
        alignment="center"
        modifiers={[
          frame({ maxWidth: Infinity }),
          contentShape(shapes.rectangle()),
          padding({ vertical: 12 }),
        ]}
      >
        <VStack alignment="leading" spacing={2}>
          <SwiftUIText modifiers={[font({ size: 16 }), foregroundStyle('primary')]}>
            {target.displayName}
          </SwiftUIText>
          {target.detail ? (
            <SwiftUIText
              modifiers={[font({ size: 12 }), foregroundStyle('secondary'), lineLimit(1)]}
            >
              {target.detail}
            </SwiftUIText>
          ) : null}
        </VStack>
        <Spacer />
        {selected ? (
          <Image systemName="checkmark.circle.fill" size={22} color={iosKindTints.text} />
        ) : (
          <Image systemName="circle" size={22} color={TERTIARY_LABEL} />
        )}
      </HStack>
    </SwiftUIButton>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 },
});
