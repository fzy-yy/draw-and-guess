/**
 * 无障碍文案（按用途分层）：供 aria-* 与悬浮 title 使用。
 *
 * 分类口径见 .scratch/strings-layering-and-maintenance/spec.md。
 */

export const settings = {
  categoryAria: '设置分类',
  setShortcutAria: (name: string) => `设置${name}快捷键`,
} as const
