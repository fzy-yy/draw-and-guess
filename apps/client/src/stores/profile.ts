/**
  玩家本地资料与身份凭证 Store。
  负责持久化储存 nickname、avatarId 与服务端下发的 recoveryToken。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG } from '@draw-guess/config'
import { RecoveryTokenSchema, isAvatarId, type Profile } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'
import { EVENTS } from '@draw-guess/shared'

export interface StoredProfile extends Profile {
  /** 只有服务端签发且不会公开的恢复令牌可用于接管既有 UUID 身份。 */
  recoveryToken?: string
}

function randomItem<T>(items: readonly T[]): T {
  const picked = items[Math.floor(Math.random() * items.length)]
  // noUncheckedIndexedAccess 下索引带 undefined；调用方全部传非空白名单，抛错仅为兜底防御
  if (picked === undefined) throw new Error('randomItem 需要一个非空数组')
  return picked
}

/** 从 localStorage 加载本地资料；损坏时回退到随机资料。 */
export function loadProfile(): StoredProfile {
  try {
    const stored = localStorage.getItem(APP_CONFIG.app.storageKey)
    if (stored) {
      // localStorage 属不可信输入：JSON.parse 结果按 unknown 逐字段守卫，不做整体形状断言
      const raw: unknown = JSON.parse(stored)
      const parsed: Record<string, unknown> =
        typeof raw === 'object' && raw !== null ? { ...raw } : {}
      // 头像只接受内置编号；旧版 avatarColor 或损坏资料会安全迁移为随机 SVG 头像。
      const avatarId = isAvatarId(parsed.avatarId)
        ? parsed.avatarId
        : randomItem(APP_CONFIG.player.avatarIds)
      if (typeof parsed.nickname === 'string') {
        const base = { nickname: parsed.nickname, avatarId }
        const token = RecoveryTokenSchema.safeParse(parsed.recoveryToken)
        return token.success ? { ...base, recoveryToken: token.data } : base
      }
    }
  } catch {
    // 本地存储损坏时安全回退到随机资料
  }
  return {
    nickname: randomItem(APP_CONFIG.player.defaultNicknames),
    avatarId: randomItem(APP_CONFIG.player.avatarIds),
  }
}

export const useProfileStore = defineStore('profile', () => {
  const { request, notify } = useGameTransport()
  const profile = ref<StoredProfile>(loadProfile())

  /** 保存本地资料到 localStorage。 */
  function saveProfile(): void {
    localStorage.setItem(APP_CONFIG.app.storageKey, JSON.stringify(profile.value))
  }

  /** 清除本地持久化资料并立即恢复为随机资料（注销身份时调用）。 */
  function clearStoredProfile(): void {
    localStorage.removeItem(APP_CONFIG.app.storageKey)
    profile.value = loadProfile()
  }

  /** 重置并保存新的随机资料。 */
  function randomizeProfile(): void {
    profile.value = {
      ...profile.value,
      nickname: randomItem(APP_CONFIG.player.defaultNicknames),
      avatarId: randomItem(APP_CONFIG.player.avatarIds),
    }
  }

  /** 提交资料修改并保存。request 契约上不抛错（失败已提示），此处无需再包 try/catch。 */
  async function updateProfile(): Promise<void> {
    const result = await request(EVENTS.sessionUpdateProfile, {
      profile: { nickname: profile.value.nickname, avatarId: profile.value.avatarId },
    })
    if (!result.ok) return
    profile.value = { ...profile.value, ...result.data }
    saveProfile()
    notify(strings.store.profileUpdated)
  }

  return {
    profile,
    saveProfile,
    clearStoredProfile,
    randomizeProfile,
    updateProfile,
  }
})
