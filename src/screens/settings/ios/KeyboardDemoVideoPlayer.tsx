import React from 'react';
import { StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

/**
 * Silent looping player for the Keyboard page's demo. Mixed with other audio
 * so it never interrupts the user's music. Loaded only when the ExpoVideo
 * native module exists (see KeyboardPage).
 */
export function KeyboardDemoVideoPlayer({ source }: { source: number }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.video}
      contentFit="contain"
      nativeControls={false}
      allowsVideoFrameAnalysis={false}
      fullscreenOptions={{ enable: false }}
    />
  );
}

const styles = StyleSheet.create({
  video: { width: '100%', height: '100%' },
});
