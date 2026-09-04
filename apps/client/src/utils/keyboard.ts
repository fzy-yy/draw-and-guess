/**
 * 画板工具快捷键的共享判定逻辑。
 * 设置页的「捕获校验」与对局内的「触发匹配」共用同一规则，
 * 避免出现「能保存但永远无法触发」的死快捷键（曾因捕获端未拒绝 Shift 导致）。
 */

/** 快捷键设置键名类型（工具 → 本地设置字段），ShortcutsTab 与 SettingsView 共用。 */
export type ShortcutSettingKey = 'penShortcut' | 'eraserShortcut' | 'fillShortcut'

/** 快捷键比较口径：忽略大小写与首尾空白（与捕获存储口径一致）。 */
export function normalizedShortcut(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** 是否为「无修饰键的单可打印字符」：捕获与触发两端共用，保证规则严格一致。 */
export function isUnmodifiedPrintableKey(event: {
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  key: string
}): boolean {
  // Shift 组合会产生独立字符（如 !、A），而触发匹配不处理任何修饰键，
  // 因此捕获端也必须拒绝，否则该快捷键将永远无法触发。
  return (
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.trim().length === 1
  )
}
