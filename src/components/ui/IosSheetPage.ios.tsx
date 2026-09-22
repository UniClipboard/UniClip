import React from 'react';
import { Form, VStack } from '@expo/ui/swift-ui';
import {
  background,
  frame,
  listStyle,
  padding,
  scrollContentBackground,
  tint,
  type ModifierConfig,
} from '@expo/ui/swift-ui/modifiers';

import { iosAccentColor, iosColors } from '@/theme/iosDesignTokens';
import { SheetHeader, type SheetHeaderProps } from './SheetHeader';

export interface IosSheetPageProps extends SheetHeaderProps {
  children: React.ReactNode;
  spacing?: number;
  modifiers?: ModifierConfig[];
}

export interface IosSheetFormProps {
  children: React.ReactNode;
  modifiers?: ModifierConfig[];
}

export interface IosSheetScaffoldProps {
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentAlignment?: 'top' | 'center';
  modifiers?: ModifierConfig[];
}

const sheetPageBackgroundColor = iosColors?.systemGroupedBackground ?? '#F2F2F7';
const sheetPageBaseModifiers = [
  frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }),
  background(sheetPageBackgroundColor),
  ...(iosAccentColor ? [tint(iosAccentColor)] : []),
];
const sheetFormBaseModifiers = [
  listStyle('insetGrouped'),
  scrollContentBackground('hidden'),
  background(sheetPageBackgroundColor),
];

export function IosSheetPage({
  title,
  left,
  right,
  leftSlots,
  rightSlots,
  children,
  spacing,
  modifiers = [],
}: IosSheetPageProps) {
  return (
    <VStack spacing={spacing} modifiers={[...sheetPageBaseModifiers, ...modifiers]}>
      <SheetHeader
        title={title}
        left={left}
        right={right}
        leftSlots={leftSlots}
        rightSlots={rightSlots}
      />
      {children}
    </VStack>
  );
}

export function IosSheetForm({ children, modifiers = [] }: IosSheetFormProps) {
  return <Form modifiers={[...sheetFormBaseModifiers, ...modifiers]}>{children}</Form>;
}

export function IosSheetScaffold({
  children,
  footer,
  contentAlignment = 'top',
  modifiers = [],
}: IosSheetScaffoldProps) {
  return (
    <VStack
      spacing={0}
      modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), ...modifiers]}
    >
      <VStack
        spacing={0}
        modifiers={[
          frame({
            maxWidth: Infinity,
            maxHeight: Infinity,
            alignment: contentAlignment,
          }),
        ]}
      >
        {children}
      </VStack>
      {footer ? (
        <VStack
          spacing={4}
          modifiers={[
            frame({ maxWidth: Infinity }),
            padding({ horizontal: 20, top: 10, bottom: 16 }),
          ]}
        >
          {footer}
        </VStack>
      ) : null}
    </VStack>
  );
}
