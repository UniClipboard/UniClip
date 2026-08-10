import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, CameraView, useCameraPermissions } from 'expo-camera';
import Ionicons from '@expo/vector-icons/Ionicons';
import { File } from 'expo-file-system';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMessageStore } from '@/stores/messageStore';
import type { CameraCaptureSheetProps } from './CameraCaptureSheet.types';

type CaptureMode = 'picture' | 'video';
type FlashMode = 'off' | 'on' | 'auto';

const FLASH_ORDER: FlashMode[] = ['off', 'on', 'auto'];

/** stopRecording 后等待原生 Finalize 的最长时间;超时视为录制失败并释放按钮 */
const RECORD_FINALIZE_TIMEOUT_MS = 10_000;

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Android 自绘相机页。Android 的系统相机 intent 只支持拍照或录像之一
 * (MediaStore 的 ACTION_IMAGE_CAPTURE / ACTION_VIDEO_CAPTURE 互斥),
 * 任何 App 用系统 intent 调起时相机都只会呈现单模式;这里用 expo-camera
 * 提供照片/视频切换,补上系统相机做不到的能力。iOS 不走本组件(系统相机自带切换)。
 */
export function CameraCaptureSheet({
  visible,
  onClose,
  onCapture,
  theme,
}: CameraCaptureSheetProps) {
  const { t } = useTranslation('home');
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<CaptureMode>('picture');
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);
  // 拍照/录像进行中(含 stopRecording 后的收尾)防重复触发
  const busyRef = useRef(false);
  const requestedRef = useRef(false);
  // 用户主动关闭时置位:recordAsync 的 promise 会因 stopRecording 继续 resolve,
  // 但此时应放弃录制结果,不再回调 onCapture。
  const discardRef = useRef(false);
  // 当前录像的 recordAsync promise;停止/自动结束统一走 finalizeRecording 收尾。
  const recordPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const finalizingRef = useRef(false);
  // finalizeRecording 的 race 超时触发器:开始录制时挂起(不设限),停止时才启动 10s 兜底。
  const finalizeTimeoutTriggerRef = useRef<(() => void) | null>(null);

  // 首次展示时请求相机权限;请求过仍拒绝则提示并关闭。
  useEffect(() => {
    if (!visible) {
      requestedRef.current = false;
      return;
    }
    if (permission?.granted) return;
    if (!requestedRef.current) {
      requestedRef.current = true;
      void requestPermission();
    } else if (permission && !permission.granted) {
      useMessageStore.getState().showMessage(t('toast.cameraPermissionNeeded'), 'error');
      onClose();
    }
  }, [visible, permission, requestPermission, onClose, t]);

  // 录像计时
  useEffect(() => {
    if (!recording) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const closeSheet = useCallback(() => {
    discardRef.current = true;
    if (recording) cameraRef.current?.stopRecording();
    setRecording(false);
    busyRef.current = false;
    onClose();
  }, [recording, onClose]);

  const handleMountError = useCallback(() => {
    useMessageStore.getState().showMessage(t('toast.cameraUnavailable'), 'error');
    closeSheet();
  }, [closeSheet, t]);

  // 录像收尾(幂等,停止与自动结束两条路径共用):等 recordAsync 的 promise 在
  // stopRecording 后 resolve,随后提交视频。超时由停止分支启动,兜底原生 Finalize
  // 事件丢失导致 promise 永久悬挂(表现为「只能停止、不能完成」)。
  const finalizeRecording = useCallback(async () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    const timeoutTrigger = new Promise<never>((_, reject) => {
      finalizeTimeoutTriggerRef.current = () => reject(new Error('E_RECORD_FINALIZE_TIMEOUT'));
    });
    try {
      const video = await Promise.race([recordPromiseRef.current, timeoutTrigger]);
      if (video && !discardRef.current) {
        onCapture({
          uri: video.uri,
          fileName: `video_${Date.now()}.mp4`,
          mimeType: 'video/mp4',
          fileSize: new File(video.uri).size,
        });
      }
    } catch {
      useMessageStore.getState().showMessage(t('toast.takeVideoFailed'), 'error');
    } finally {
      finalizeTimeoutTriggerRef.current = null;
      finalizingRef.current = false;
      recordPromiseRef.current = null;
      busyRef.current = false;
      setRecording(false);
    }
  }, [onCapture, t]);

  const handleShutter = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam) return;

    // 录制中再次点击 = 停止并完成:stopRecording 触发原生 Finalize,
    // finalizeRecording 在 promise resolve 后提交视频。原生 Finalize 丢失时,
    // 用 10s 兜底超时强制收尾(提示失败并释放按钮)。
    if (recording) {
      setRecording(false);
      cam.stopRecording();
      const trigger = finalizeTimeoutTriggerRef.current;
      if (trigger) {
        setTimeout(trigger, RECORD_FINALIZE_TIMEOUT_MS);
      }
      void finalizeRecording();
      return;
    }

    if (busyRef.current) return;

    if (mode === 'picture') {
      busyRef.current = true;
      try {
        const photo = await cam.takePictureAsync({ quality: 1 });
        if (photo && !discardRef.current) {
          onCapture({
            uri: photo.uri,
            fileName: `photo_${Date.now()}.jpg`,
            mimeType: 'image/jpeg',
            fileSize: new File(photo.uri).size,
          });
        }
      } catch {
        useMessageStore.getState().showMessage(t('toast.takePhotoFailed'), 'error');
      } finally {
        busyRef.current = false;
      }
      return;
    }

    // Android 上录像需要 RECORD_AUDIO 权限,未授权时原生 record 会直接抛错;
    // 先请求再进入录制状态。
    busyRef.current = true;
    try {
      const micPerm = await Camera.requestMicrophonePermissionsAsync();
      if (!micPerm.granted) {
        useMessageStore.getState().showMessage(t('toast.micPermissionNeeded'), 'error');
        return;
      }
    } catch {
      useMessageStore.getState().showMessage(t('toast.takeVideoFailed'), 'error');
      return;
    } finally {
      busyRef.current = false;
    }

    setRecording(true);
    busyRef.current = true;
    recordPromiseRef.current = cam.recordAsync();
    void finalizeRecording();
  }, [mode, recording, onCapture, finalizeRecording, t]);

  const nextFlash = () =>
    setFlash((f) => FLASH_ORDER[(FLASH_ORDER.indexOf(f) + 1) % FLASH_ORDER.length]);

  const shutterInner = recording ? (
    <View style={[s.shutterStop, { backgroundColor: theme.colors.white }]} />
  ) : (
    <View
      style={[
        s.shutterFill,
        { backgroundColor: mode === 'video' ? theme.colors.error : theme.colors.white },
      ]}
    />
  );

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={closeSheet}>
      <View style={s.root}>
        <CameraView
          ref={cameraRef}
          style={s.camera}
          facing={facing}
          flash={flash}
          mode={mode}
          onCameraReady={() => setReady(true)}
          onMountError={handleMountError}
        />

        {/* 顶部控制条(闪光灯居中;预览全屏沉浸,控件按状态栏 inset 下移避开刘海/挖孔) */}
        <View style={[s.topBar, { paddingTop: insets.top + 12 }]}>
          <Pressable
            onPress={nextFlash}
            disabled={recording}
            style={[s.topButton, { opacity: recording ? 0.4 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.toggleFlash')}
          >
            <Ionicons
              name={flash === 'off' ? 'flash-off' : flash === 'on' ? 'flash' : 'flash-outline'}
              size={24}
              color={theme.colors.white}
            />
          </Pressable>
        </View>

        {/* 底部控制:关闭 / 快门 / 翻转 */}
        <View style={[s.bottomArea, { paddingBottom: Math.max(insets.bottom, 12) + 20 }]}>
          {recording && (
            <View style={s.recBadge}>
              <View style={s.recDot} />
              <Text style={s.recTime}>{formatElapsed(elapsed)}</Text>
            </View>
          )}

          <View style={[s.modeSwitch, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
            {(['picture', 'video'] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  if (recording) return;
                  setMode(m);
                }}
                style={[
                  s.modeChip,
                  { backgroundColor: mode === m ? 'rgba(255,255,255,0.22)' : 'transparent' },
                ]}
                accessibilityRole="button"
                accessibilityLabel={m === 'picture' ? t('fab.photoMode') : t('fab.videoMode')}
              >
                <Ionicons
                  name={m === 'picture' ? 'camera' : 'videocam'}
                  size={16}
                  color={theme.colors.white}
                />
                <Text style={s.modeLabel}>
                  {m === 'picture' ? t('fab.photoMode') : t('fab.videoMode')}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={s.shutterRow}>
            <Pressable
              onPress={closeSheet}
              style={s.sideButton}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.closeCamera')}
            >
              <Ionicons name="close" size={26} color={theme.colors.white} />
            </Pressable>
            <Pressable
              onPress={handleShutter}
              disabled={!ready}
              style={[s.shutterRing, { opacity: ready ? 1 : 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel={
                recording
                  ? t('a11y.stopRecording')
                  : mode === 'video'
                  ? t('a11y.startRecording')
                  : t('a11y.takePicture')
              }
            >
              {shutterInner}
            </Pressable>
            <Pressable
              onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
              disabled={recording}
              style={[s.sideButton, { opacity: recording ? 0.4 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.switchCamera')}
            >
              <Ionicons name="camera-reverse" size={28} color={theme.colors.white} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  camera: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  topButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  recTime: {
    color: '#FFFFFF',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  bottomArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    gap: 18,
  },
  modeSwitch: {
    flexDirection: 'row',
    borderRadius: 22,
    padding: 3,
    gap: 2,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 19,
  },
  modeLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    justifyContent: 'center',
  },
  sideButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 40,
  },
  shutterRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterFill: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  shutterStop: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
});
