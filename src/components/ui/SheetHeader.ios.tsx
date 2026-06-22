import React from 'react';
import { HStack, Text as SwiftUIText, Spacer } from '@expo/ui/swift-ui';
import { font, frame, padding } from '@expo/ui/swift-ui/modifiers';

export interface SheetHeaderProps {
  title: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export function SheetHeader({ title, left, right }: SheetHeaderProps) {
  return (
    <HStack alignment="center" modifiers={[frame({ maxWidth: Infinity }), padding({ horizontal: 20, top: 16, bottom: 12 })]}>
      {left ?? <Spacer modifiers={[frame({ width: 44 })]} />}
      <Spacer />
      <SwiftUIText modifiers={[font({ weight: 'bold', size: 17 })]}>{title}</SwiftUIText>
      <Spacer />
      {right ?? <Spacer modifiers={[frame({ width: 44 })]} />}
    </HStack>
  );
}
