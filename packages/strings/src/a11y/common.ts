/**
 * 无障碍文案（按用途分层）：供 aria-* 与悬浮 title 使用。
 *
 * 分类口径见 CONTEXT.md。
 */
import { clampLatency } from '../internal/latency.ts'

export const common = {
  accept: '接受',
  declineCountdown: (seconds: number) => `拒绝(${seconds})`,
  dismissToastAria: (text: string) => `关闭提示：${text}`,
  clearSearchAria: '清除搜索内容',
  listSeparator: '、',
  sortByAria: (name: string) => `按${name}排序`,
  emptyDash: '—',
  networkStatusAria: (label: string, latency: number) =>
    `${label} · 延迟 ${latency ? clampLatency(latency) : common.emptyDash} 毫秒`,
  connectionDetail: (label: string, latency: number) =>
    `${label} · ${latency ? clampLatency(latency) : common.emptyDash} ms`,
  exit: '退出',
  myAvatarAria: '我的 SVG 头像',
  playerAvatarAria: (nickname: string) => `${nickname}的 SVG 头像`,
  // 通用右键菜单的默认无障碍名称（具体场景可用 ariaLabel 覆盖，见 ContextMenu.vue）
  contextMenuAria: '右键菜单',
} as const
