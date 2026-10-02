/**
 * 无障碍文案（按用途分层）：供 aria-* 与悬浮 title 使用。
 *
 * 分类口径见 CONTEXT.md。
 */

export const profile = {
  brandAria: '游戏介绍',
  randomizeAria: '重新随机昵称与 SVG 头像',
  nicknameValidAria: '昵称有效',
  changeAvatarAria: '打开 SVG 头像选择',
  avatarPickerCloseAria: '关闭头像选择',
  avatarOptionAria: (id: string) => `选择第 ${id} 号头像`,
} as const
