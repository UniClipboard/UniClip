import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Host, AlertDialog, TextButton, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { AppBottomSheet } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import {
  classifyURL,
  effectiveURLs,
  getURLClassDisplay,
  URL_CLASS_DISPLAY_ORDER,
  URL_CLASS_IONICONS,
  type ServerURLClass,
} from '@/utils/classifyUrl';
import type { ServerConfig } from '@/types/api';
import type { ServerSwitcherModalProps } from './ServerSwitcherModal.types';
import { AddServerSheet } from './AddServerSheet';
import type { AddServerSaveData } from './AddServerSheet.types';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function useNetworkTags(server: ServerConfig) {
  return useMemo(() => {
    const urls = effectiveURLs(server.urls, server.url);
    const set = new Set<ServerURLClass>();
    for (const u of urls) set.add(classifyURL(u));
    const tags = URL_CLASS_DISPLAY_ORDER.filter((c) => set.has(c)).map((c) => ({
      cls: c,
      label: getURLClassDisplay(c).label,
      icon: URL_CLASS_IONICONS[c] as IoniconName,
    }));
    return { count: urls.length, tags };
  }, [server.urls, server.url]);
}

function toEditData(server: ServerConfig): AddServerSaveData {
  return {
    name: server.name ?? '',
    urls: server.urls && server.urls.length > 0 ? server.urls : [server.url],
    username: server.username ?? '',
    password: server.password ?? '',
  };
}

function serverLabel(server: ServerConfig): string {
  return server.name || server.url;
}

type Theme = ServerSwitcherModalProps['theme'];

function SwipeActionButtons({
  theme,
  methods,
  onEdit,
  onDelete,
}: {
  theme: Theme;
  methods: SwipeableMethods;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const c = theme.colors;
  return (
    <View style={s.swipeActions}>
      {/* ripple 是 Pressable 自己的背景层,裁剪必须放在外层容器 */}
      <View style={[s.swipeBtnClip, { backgroundColor: c.primaryContainer }]}>
        <Pressable
          style={s.swipeBtn}
          android_ripple={{ color: c.outlineVariant }}
          onPress={() => {
            methods.close();
            onEdit();
          }}
        >
          <Ionicons name="create-outline" size={20} color={c.onPrimaryContainer} />
          <Text style={[s.swipeBtnText, { color: c.onPrimaryContainer }]}>编辑</Text>
        </Pressable>
      </View>
      <View style={[s.swipeBtnClip, { backgroundColor: c.errorContainer }]}>
        <Pressable
          style={s.swipeBtn}
          android_ripple={{ color: c.outlineVariant }}
          onPress={() => {
            methods.close();
            onDelete();
          }}
        >
          <Ionicons name="trash-outline" size={20} color={c.onErrorContainer} />
          <Text style={[s.swipeBtnText, { color: c.onErrorContainer }]}>删除</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ServerCard({
  server,
  isActive,
  theme,
  onSelect,
  onEdit,
  onDelete,
}: {
  server: ServerConfig;
  isActive: boolean;
  theme: Theme;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { count, tags } = useNetworkTags(server);
  const c = theme.colors;

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={(_progress, _translation, methods) => (
        <SwipeActionButtons theme={theme} methods={methods} onEdit={onEdit} onDelete={onDelete} />
      )}
    >
      {/* 圆角+裁剪放外层:ripple 是 Pressable 自己的背景层,裁不掉自己 */}
      <View
        style={[
          s.cardClip,
          { backgroundColor: isActive ? c.primaryContainer : c.surfaceContainerLow },
          isActive && { borderWidth: 1.5, borderColor: c.primary },
        ]}
      >
        <Pressable onPress={onSelect} android_ripple={{ color: c.outlineVariant }} style={s.card}>
          <Ionicons
            name={isActive ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={isActive ? c.primary : c.outline}
          />
          <View style={s.info}>
            <Text
              style={[s.name, { color: c.onSurface, fontWeight: isActive ? '700' : '600' }]}
              numberOfLines={1}
            >
              {serverLabel(server)}
            </Text>
            <Text style={[s.url, { color: c.onSurfaceVariant }]} numberOfLines={1}>
              {server.url}
            </Text>
            <View style={s.tagRow}>
              {tags.map((tag) => (
                <View key={tag.cls} style={[s.tag, { backgroundColor: c.surfaceContainerHighest }]}>
                  <Ionicons name={tag.icon} size={11} color={c.onSurfaceVariant} />
                  <Text style={[s.tagText, { color: c.onSurfaceVariant }]}>{tag.label}</Text>
                </View>
              ))}
              <Text style={[s.count, { color: c.onSurfaceVariant }]}>{count} 个地址</Text>
            </View>
          </View>
        </Pressable>
      </View>
    </ReanimatedSwipeable>
  );
}

export function ServerSwitcherModal({
  visible,
  servers,
  activeIndex,
  onSelect,
  onClose,
  theme,
}: ServerSwitcherModalProps) {
  const c = theme.colors;
  const { height: windowHeight } = useWindowDimensions();
  const { addServer, updateServer, deleteServer } = useSettingsStore();
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  const editingServer = editingIndex != null ? servers[editingIndex] : undefined;
  const deleteServerTarget = deleteIndex != null ? servers[deleteIndex] : undefined;
  const sheetVisible = showAddSheet || editingServer != null;

  const handleSave = useCallback(
    async (data: AddServerSaveData) => {
      const payload = {
        url: data.urls[0],
        urls: data.urls,
        name: data.name || undefined,
        username: data.username,
        password: data.password,
      };
      if (editingIndex != null) {
        await updateServer(editingIndex, payload);
      } else {
        await addServer({ type: 'syncclipboard', ...payload });
      }
      setShowAddSheet(false);
      setEditingIndex(null);
    },
    [editingIndex, updateServer, addServer]
  );

  return (
    <>
      <AppBottomSheet visible={visible} onDismiss={onClose} containerColor={c.surface}>
        <View style={[s.content, { maxHeight: windowHeight * 0.62 }]}>
          <View style={s.header}>
            <Pressable onPress={onClose} style={s.headerBtn} hitSlop={8}>
              <Ionicons name="close" size={22} color={c.onSurface} />
            </Pressable>
            <Text style={[s.headerTitle, { color: c.onSurface }]}>服务器</Text>
            <Pressable onPress={() => setShowAddSheet(true)} style={s.headerBtn} hitSlop={8}>
              <Ionicons name="add" size={24} color={c.primary} />
            </Pressable>
          </View>

          {servers.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="server-outline" size={40} color={c.outlineVariant} />
              <Text style={[s.emptyText, { color: c.onSurfaceVariant }]}>还没有服务器</Text>
              <Pressable
                onPress={() => setShowAddSheet(true)}
                style={[s.addBtn, { backgroundColor: c.primary }]}
              >
                <Ionicons name="add" size={18} color={c.onPrimary} />
                <Text style={[s.addBtnText, { color: c.onPrimary }]}>添加服务器</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
              {servers.map((server, index) => (
                <ServerCard
                  key={`${server.url}-${index}`}
                  server={server}
                  isActive={index === activeIndex}
                  theme={theme}
                  onSelect={() => onSelect(index)}
                  onEdit={() => setEditingIndex(index)}
                  onDelete={() => setDeleteIndex(index)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </AppBottomSheet>

      {/* 删除确认 */}
      {deleteServerTarget && (
        <Host>
          <AlertDialog onDismissRequest={() => setDeleteIndex(null)}>
            <AlertDialog.Title>
              <ComposeText>删除服务器</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText>{`确定要删除「${serverLabel(deleteServerTarget)}」吗？`}</ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton
                onClick={() => {
                  const idx = deleteIndex;
                  setDeleteIndex(null);
                  if (idx != null) void deleteServer(idx);
                }}
              >
                <ComposeText>删除</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => setDeleteIndex(null)}>
                <ComposeText>取消</ComposeText>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        </Host>
      )}

      <AddServerSheet
        visible={sheetVisible}
        title={editingServer ? '编辑服务器' : undefined}
        initialData={editingServer ? toEditData(editingServer) : undefined}
        onClose={() => {
          setShowAddSheet(false);
          setEditingIndex(null);
        }}
        onSave={handleSave}
      />
    </>
  );
}

const s = StyleSheet.create({
  content: { paddingBottom: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  list: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 10 },
  cardClip: {
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  info: { flex: 1, gap: 3 },
  name: { fontSize: 16 },
  url: { fontSize: 13 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1, flexWrap: 'wrap' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tagText: { fontSize: 11, fontWeight: '500' },
  count: { fontSize: 11 },
  swipeActions: { flexDirection: 'row', alignItems: 'stretch', gap: 8, paddingLeft: 8 },
  swipeBtnClip: {
    width: 64,
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  swipeBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeBtnText: { fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { textAlign: 'center', fontSize: 15 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 8,
  },
  addBtnText: { fontSize: 14, fontWeight: '600' },
});
