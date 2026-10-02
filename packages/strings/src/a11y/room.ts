/**
 * 无障碍文案（按用途分层）：供 aria-* 与悬浮 title 使用。
 *
 * 分类口径见 CONTEXT.md。
 */

export const room = {
  copyPrivateCodeAria: '复制私密房间码',
  hostCrownAria: '房主',
  kickAria: '移除该玩家',
  transferHostAria: '移交房主',
  seatMenuAria: '席位操作菜单',
  inviteCooldownAria: (seconds: number) => `邀请冷却中，${seconds} 秒后可重试`,
  vocabToggleAllAria: '全选或取消当前结果',
  spectatorReadyTitle: '观战成员不能参与准备',
  vocabCloseAria: '关闭词库',
  vocabSearchAria: '搜索词条',
  vocabFilterAria: (name: string) => `按${name}筛选`,
  vocabPackageSelectionColumn: '选择词库',
  vocabSwitchToPackages: '切换词库选择',
  vocabSwitchToWords: '返回词条列表',
  vocabPackageSelectAria: (name: string) => `选择词库 ${name}`,
  vocabPackageSearchAria: '搜索词库',
  settingsCloseAria: '关闭规则',
  inviteCloseAria: '关闭邀请',
} as const
