import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ServerSwitcherModalProps } from './ServerSwitcherModal.types';

export function ServerSwitcherModal({ visible, servers, activeIndex, onSelect, onClose, onAdd, theme }: ServerSwitcherModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}><View /></Pressable>
      <View style={[s.sheet, { backgroundColor: theme.colors.surface }]}>
        <View style={s.handleRow}>
          <View style={[s.handle, { backgroundColor: theme.colors.outlineVariant }]} />
        </View>
        <View style={s.header}>
          <Pressable onPress={onClose} style={s.headerBtn}>
            <Ionicons name="close" size={20} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={[s.headerTitle, { color: theme.colors.onSurface }]}>服务器</Text>
          <Pressable onPress={onAdd} style={s.headerBtn}>
            <Ionicons name="add" size={22} color={theme.colors.primary} />
          </Pressable>
        </View>
        <ScrollView style={s.list}>
          {servers.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="server-outline" size={40} color={theme.colors.outlineVariant} />
              <Text style={[s.emptyText, { color: theme.colors.onSurfaceVariant }]}>还没有服务器</Text>
              <Pressable onPress={onAdd} style={[s.addBtn, { backgroundColor: theme.colors.primary }]}>
                <Ionicons name="add" size={18} color={theme.colors.onPrimary} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.onPrimary }}>添加服务器</Text>
              </Pressable>
            </View>
          ) : (
            servers.map((server, index) => {
              const isActive = index === activeIndex;
              return (
                <Pressable
                  key={`${server.url}-${index}`}
                  onPress={() => onSelect(index)}
                  style={[s.row, { backgroundColor: isActive ? 'rgba(76,175,80,0.08)' : 'transparent' }]}
                >
                  <Ionicons
                    name={isActive ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={isActive ? '#4CAF50' : theme.colors.onSurfaceVariant}
                  />
                  <View style={s.info}>
                    <Text style={[s.name, { color: theme.colors.onSurface }]} numberOfLines={1}>{server.name || server.url}</Text>
                    <Text style={[s.url, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>{server.url}</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '60%', paddingBottom: 32 },
  handleRow: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  list: { paddingHorizontal: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, marginBottom: 2 },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  url: { fontSize: 12 },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  emptyText: { textAlign: 'center', fontSize: 14 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, marginTop: 8 },
});
