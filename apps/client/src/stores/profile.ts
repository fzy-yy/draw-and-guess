/**
  玩家本地资料与身份凭证 Store。
  负责持久化储存 nickname、avatarId 与服务端下发的 recoveryToken。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG } from '@draw-guess/config'
import { RecoveryTokenSchema, type Profile } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { notify } from '@/composables/useToasts'
import { socket } from './socket.ts'
import { createRequester } from './request.ts'
import { EVENTS } from '@draw-guess/shared'

export interface StoredProfile extends Profile {
  /** 只有服务端签发且不会公开的恢复令牌可用于接管既有 UUID 身份。 */
  recoveryToken?: string
}

function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T
}

/** 从 localStorage 加载本地资料；损坏时回退到随机资料。 */
export function loadProfile(): StoredProfile {
  try {
    const stored = localStorage.getItem(APP_CONFIG.app.storageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<StoredProfile>
      // 头像只接受内置编号；旧版 avatarColor 或损坏资料会安全迁移为随机 SVG 头像。
      const avatarId = (APP_CONFIG.player.avatarIds as readonly string[]).includes(
        parsed.avatarId ?? '',
      )
        ? (parsed.avatarId ?? APP_CONFIG.player.defaultAvatarId)
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
  const profile = ref<StoredProfile>(loadProfile())
  const request = createRequester({ socket, notify })

  /** 保存本地资料到 localStorage。 */
  function saveProfile(): void {
    localStorage.setItem(APP_CONFIG.app.storageKey, JSON.stringify(profile.value))
  }

  /** 重置并保存新的随机资料。 */
  function randomizeProfile(): void {
    profile.value = {
      ...profile.value,
      nickname: randomItem(APP_CONFIG.player.defaultNicknames),
      avatarId: randomItem(APP_CONFIG.player.avatarIds),
    }
  }

  /** 提交资料修改并保存。 */
  async function updateProfile(): Promise<void> {
    try {
      const result = await request<Profile>(EVENTS.sessionUpdateProfile, {
        profile: { nickname: profile.value.nickname, avatarId: profile.value.avatarId },
      })
      if (!result.ok) return
      profile.value = { ...profile.value, ...result.data }
      saveProfile()
      notify(strings.store.profileUpdated)
    } catch {
      // 网络请求已处理提示
    }
  }

  return {
    profile,
    saveProfile,
    randomizeProfile,
    updateProfile,
  }
})
