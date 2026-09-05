/**
  本地设置 Store。
  负责管理音量、快捷键、动画开关、发现与邀请偏好。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import { EVENTS } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { notify } from '@/composables/useToasts'
import { socket } from './socket.ts'
import { createRequester } from './request.ts'

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

/** 从 localStorage 加载本地设置；缺失字段回退默认值，非法快捷键逐项修复。 */
export function loadSettings(): LocalSettings {
  try {
    const stored = localStorage.getItem(APP_CONFIG.app.settingsStorageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<LocalSettings>
      const loaded = Object.fromEntries(
        Object.entries(PUBLIC_CONFIG.localSettings).map(([key, fallback]) => [
          key,
          parsed[key as keyof LocalSettings] ?? fallback,
        ]),
      ) as LocalSettings

      const booleanKeys = [
        'muted',
        'animationsEnabled',
        'showShortcuts',
        'autoFocusGuess',
        'discoverable',
        'acceptsInvites',
      ] as const
      for (const key of booleanKeys) {
        if (typeof parsed[key] !== 'boolean') loaded[key] = PUBLIC_CONFIG.localSettings[key]
      }

      const volumeKeys = ['masterVolume', 'soundVolume', 'musicVolume'] as const
      for (const key of volumeKeys) {
        const value = parsed[key]
        loaded[key] =
          typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
            ? value
            : PUBLIC_CONFIG.localSettings[key]
      }

      const shortcutKeys = ['penShortcut', 'eraserShortcut', 'fillShortcut'] as const
      const shortcuts = shortcutKeys.map((key) => String(loaded[key]).trim().toLocaleLowerCase())
      const shortcutsAreValid =
        shortcuts.every((shortcut) => shortcut.length === 1) &&
        new Set(shortcuts).size === shortcutKeys.length
      shortcutKeys.forEach((key, index) => {
        loaded[key] = shortcutsAreValid
          ? (shortcuts[index] ?? PUBLIC_CONFIG.localSettings[key])
          : PUBLIC_CONFIG.localSettings[key]
      })
      return loaded
    }
  } catch {
    // 设置损坏时恢复默认值
  }
  return { ...PUBLIC_CONFIG.localSettings }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<LocalSettings>(loadSettings())
  const request = createRequester({ socket, notify })

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
        { quiet: true },
      )
    }
  }

  /** 恢复本地设置默认值。 */
  function resetSettings(playerId?: string): void {
    settings.value = { ...PUBLIC_CONFIG.localSettings }
    saveSettings(playerId)
    notify(strings.store.settingsReset)
  }

  return {
    settings,
    saveSettings,
    resetSettings,
  }
})
