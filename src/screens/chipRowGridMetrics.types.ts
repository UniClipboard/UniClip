/**
 * 筛选 chip 行(overlay)在网格上预留空间的平台策略。
 *
 * iOS 用 contentInset:UIRefreshControl 尊重 adjustedContentInset,下拉刷新的 spinner
 * 天然出现在筛选行下方(Fabric 的 progressViewOffset 靠改 UIRefreshControl.bounds 实现,
 * 刷新动画期间会被 UIKit 重置,不可靠)。
 * Android 没有 contentInset,用内容 paddingTop 预留 + progressViewOffset 下移 spinner
 * (SwipeRefreshLayout 原生支持)。
 */
export interface ChipRowGridMetrics {
  /** 网格内容 paddingTop 的额外增量 */
  paddingTopExtra: number;
  /** ScrollView contentInset.top(iOS 专用,Android 为 0) */
  contentInsetTop: number;
  /** RefreshControl 的 progressViewOffset */
  progressViewOffset: number;
}
