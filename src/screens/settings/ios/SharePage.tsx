import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Share } from 'react-native';
import {
  Button as SwiftUIButton,
  Label,
  LabeledContent,
  Section,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { foregroundStyle } from '@expo/ui/swift-ui/modifiers';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { GuideStepRow, HeaderCircleButton } from './common';

/**
 * Share-extension guide. The extension itself needs no switch — it is
 * available as soon as the app is installed — but iOS gives no API to pin it
 * to the share sheet's favorites, so this page walks the user through doing
 * it by hand, with a button that opens a real share sheet to practice on.
 */
export function SharePage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('settingsIos');
  const handleTryShare = useCallback(() => {
    Share.share({ message: t('share.testMessage') }).catch(() => {
      // user dismissed the sheet — nothing to do
    });
  }, [t]);

  return (
    <IosSheetPage
      title={t('share.title')}
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        {/* ── 说明 ── */}
        <Section footer={<SwiftUIText>{t('share.intro.footer')}</SwiftUIText>}>
          <LabeledContent
            label={
              <Label title={t('share.supportedContent.label')} systemImage="square.and.arrow.up" />
            }
          >
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {t('share.supportedContent.value')}
            </SwiftUIText>
          </LabeledContent>
        </Section>

        {/* ── 设为常用 ── */}
        <Section
          header={<SwiftUIText>{t('share.favorite.title')}</SwiftUIText>}
          footer={<SwiftUIText>{t('share.favorite.footer')}</SwiftUIText>}
        >
          <GuideStepRow index={1} text={t('share.favorite.step1')} />
          <GuideStepRow index={2} text={t('share.favorite.step2')} />
          <GuideStepRow index={3} text={t('share.favorite.step3')} />
          <GuideStepRow index={4} text={t('share.favorite.step4')} />
        </Section>

        <Section>
          <SwiftUIButton
            systemImage="square.and.arrow.up"
            label={t('share.tryButton')}
            onPress={handleTryShare}
          />
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
