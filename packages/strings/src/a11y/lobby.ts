/**
 * 无障碍文案（按用途分层）：供 aria-* 与悬浮 title 使用。
 *
 * 分类口径见 CONTEXT.md。
 */

export const lobby = {
  fullscreenPromptAria: '全屏体验推荐提示',
  navAria: '辅助页面',
  roomListAria: '全部公开房间列表',
  playerFilterAria: '筛选在线玩家',
  createDialogCloseAria: '关闭创建房间弹窗',
  privateJoinCloseAria: '关闭私密房加入弹窗',
  privateCodeAria: '私密房间码',
  seatOccupancyAria: (occupied: number, total: number) => `席位占用情况：${occupied} / ${total}`,
} as const
