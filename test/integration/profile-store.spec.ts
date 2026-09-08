import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { APP_CONFIG } from '@draw-guess/config'
import { useProfileStore } from '@/stores/profile'

describe('资料 Store 浏览器集成', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('从 localStorage 恢复白名单头像与合法恢复令牌', () => {
    const recoveryToken = 'a'.repeat(32)
    localStorage.setItem(
      APP_CONFIG.app.storageKey,
      JSON.stringify({ nickname: '测试玩家', avatarId: '01', recoveryToken }),
    )

    const store = useProfileStore()

    expect(store.profile).toMatchObject({ nickname: '测试玩家', avatarId: '01', recoveryToken })
  })

  it('随机资料始终来自配置白名单，并可持久化当前值', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const store = useProfileStore()

    store.randomizeProfile()
    store.saveProfile()

    expect(APP_CONFIG.player.defaultNicknames).toContain(store.profile.nickname)
    expect(APP_CONFIG.player.avatarIds).toContain(store.profile.avatarId)
    expect(JSON.parse(localStorage.getItem(APP_CONFIG.app.storageKey) ?? '{}')).toMatchObject(
      store.profile,
    )
  })
})
