/**
  本地设置 Store。
  负责管理音量、快捷键、动画开关、发现与邀请偏好。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import { EVENTS } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'

export type LocalSettings = {
  -readonly [
    Key in keyof typeof PUBLIC_CONFIG.localSettings
  ]: (typeof PUBLIC_CONFIG.localSettings)[Key] extends string
    ? string
    : (typeof PUBLIC_CONFIG.localSettings)[Key] extends number
      ? number
      : (typeof PUBLIC_CONFIG.localSettings)[Key] extends boolean
        ? boolean
        : (typeof PUBLIC_CONFIG.localSettings)[Key]
}

/**
 * 从 localStorage 加载本地设置。
 * 校验规则由默认值类型推导（布尔按类型、数值限定 0~1 音量、字符串按工具快捷键），
 * 新增设置项时无需维护第二份手写键清单；缺失或非法字段逐项回退默认值。
 */
export function loadSettings(): LocalSettings {
  try {
    const stored = localStorage.getItem(APP_CONFIG.app.settingsStorageKey)
    if (stored) {
      // localStorage 属不可信输入：先按 unknown 接收，再收窄为可索引视图逐字段校验
      const raw: unknown = JSON.parse(stored)
      const parsed: Record<string, unknown> =
        typeof raw === 'object' && raw !== null ? { ...raw } : {}
      const defaults = PUBLIC_CONFIG.localSettings
      const loaded: LocalSettings = { ...defaults }
      const writable = loaded as Partial<Record<keyof LocalSettings, unknown>>
      const shortcutKeys: Array<keyof LocalSettings> = []

      for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) {
        const value = parsed[key]
        const fallback = defaults[key]
        if (typeof fallback === 'boolean') {
          writable[key] = typeof value === 'boolean' ? value : fallback
        } else if (typeof fallback === 'number') {
          writable[key] =
            typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
              ? value
              : fallback
        } else {
          shortcutKeys.push(key)
          writable[key] = typeof value === 'string' ? value : fallback
        }
      }

      // 字符串设置均为单键快捷键（画板工具 + 面板显隐）：统一小写后要求单字符且互不重复，任一不合法则整组回退默认。
      const shortcuts = shortcutKeys.map((key) => String(writable[key]).trim().toLocaleLowerCase())
      const shortcutsValid =
        shortcuts.every((shortcut) => shortcut.length === 1) &&
        new Set(shortcuts).size === shortcutKeys.length
      shortcutKeys.forEach((key, index) => {
        writable[key] = shortcutsValid ? (shortcuts[index] ?? defaults[key]) : defaults[key]
      })
      return loaded
    }
  } catch {
    // 设置损坏时恢复默认值
  }
  return { ...PUBLIC_CONFIG.localSettings }
}

export const useSettingsStore = defineStore('settings', () => {
  const { request, notify } = useGameTransport()
  const settings = ref<LocalSettings>(loadSettings())

  /** 保存本地设置到 localStorage，并同步到 DOM 与服务端。 */
  function saveSettings(playerId?: string): void {
    localStorage.setItem(APP_CONFIG.app.settingsStorageKey, JSON.stringify(settings.value))
    document.documentElement.classList.toggle('motion-disabled', !settings.value.animationsEnabled)
    if (playerId) {
      void request(
        EVENTS.presenceUpdatePreferences,
        {
          discoverable: settings.value.discoverable,
          acceptsInvites: settings.value.acceptsInvites,
        },
        // 偏好同步是后台操作：失败静默（下次变更自然带上），不重试避免堆积。
        { retry: false, notify: 'silent' },
      )
    }
  }

  /** 恢复本地设置默认值。 */
  function resetSettings(playerId?: string): void {
    settings.value = { ...PUBLIC_CONFIG.localSettings }
    saveSettings(playerId)
    notify(strings.ui.store.settingsReset)
  }

  return {
    settings,
    saveSettings,
    resetSettings,
  }
})
