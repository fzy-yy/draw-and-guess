import { beforeEach, describe, expect, it } from 'vitest'
import { setActivePinia } from 'pinia'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import { useSettingsStore } from '@/stores/settings'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'

describe('设置 Store 浏览器集成', () => {
  beforeEach(() => setActivePinia(createPiniaWithFakeTransport().pinia))

  it('损坏或越界的本地设置逐项回退，不污染其它合法偏好', () => {
    localStorage.setItem(
      APP_CONFIG.app.settingsStorageKey,
      JSON.stringify({
        animationsEnabled: false,
        masterVolume: 3,
        penShortcut: 'q',
        eraserShortcut: 'q',
        fillShortcut: 'f',
      }),
    )

    const store = useSettingsStore()

    expect(store.settings.animationsEnabled).toBe(false)
    expect(store.settings.masterVolume).toBe(PUBLIC_CONFIG.localSettings.masterVolume)
    expect(store.settings.penShortcut).toBe(PUBLIC_CONFIG.localSettings.penShortcut)
    expect(store.settings.eraserShortcut).toBe(PUBLIC_CONFIG.localSettings.eraserShortcut)
  })

  it('保存时同步 localStorage 与减弱动画 DOM 标记', () => {
    const store = useSettingsStore()
    store.settings.animationsEnabled = false
    store.settings.musicVolume = 0.35

    store.saveSettings()

    expect(document.documentElement.classList.contains('motion-disabled')).toBe(true)
    expect(
      JSON.parse(localStorage.getItem(APP_CONFIG.app.settingsStorageKey) ?? '{}'),
    ).toMatchObject({
      animationsEnabled: false,
      musicVolume: 0.35,
    })
  })
})
