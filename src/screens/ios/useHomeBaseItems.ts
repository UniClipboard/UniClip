import { useRef } from 'react';
import { useHistoryStore } from '@/features/history';
import type { ClipboardItem } from '@/types/clipboard';
import type { HomeController } from '../useHomeController';

/**
 * 搜索层下面的首页历史。搜索会把共享的历史查询换成搜索结果,所以首页在进入搜索时冻结一份,
 * 直到退出搜索后历史重新查回完整列表(无筛选且查询完成)再跟随实时数据。
 * 这样退出搜索时,搜索层退场露出的就是已经渲染好的首页,不需要等查询,也不会闪白。
 */
export function useHomeBaseItems(c: HomeController): ClipboardItem[] {
  const storeFilter = useHistoryStore((s) => s.filter);
  const snapshot = useRef(c.items);
  const live = !c.isSearching && !c.isHistoryLoading && storeFilter == null;
  if (live) snapshot.current = c.items;
  return live ? c.items : snapshot.current;
}
