/**
 * 无障碍文案（按用途分层）：供 aria-* 与悬浮 title 使用。
 *
 * 分类口径见 CONTEXT.md。
 */

export const app = {
  stageAriaLabel: (appName: string) => `${appName} 游戏舞台`,
  inviteDialogAria: '房间邀请',
  inviterAvatarAria: '邀请者 SVG 头像',
} as const
