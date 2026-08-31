/**
 * 客户端视图状态与 Socket gateway。
 * Pinia 只保存服务端裁剪后的快照及本地偏好；所有影响胜负的操作都作为请求发送给权威服务端。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { io } from 'socket.io-client'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import {
  EVENTS,
  type Ack,
  type FillCommand,
  type Invite,
  type PresenceSnapshot,
  type PublicRoom,
  type Profile,
  type RoomSettings,
  type RoomSnapshot,
  type Stroke,
  type VocabularySnapshot,
} from '@draw-guess/shared'
import { createUuid } from '@/utils/createUuid'

export type ConnectionLabel = '正在连接' | '已连接' | '连接不稳定' | '正在重连' | '无法连接'
export type ShellPage = 'profile' | 'lobby' | 'settings'

interface StoredProfile extends Profile {
  recoveryToken?: string
  recoveryTokenExpiresAt?: number
}

/** 将只读配置默认值拓宽为可编辑的本地设置类型，允许用户自定义快捷键字符。 */
type LocalSettings = {
  -readonly [
    Key in keyof typeof PUBLIC_CONFIG.localSettings
  ]: (typeof PUBLIC_CONFIG.localSettings)[Key] extends string
    ? string
    : (typeof PUBLIC_CONFIG.localSettings)[Key]
}

/** Socket 实例放在 store 外，避免 Pinia devtools 序列化传输对象和监听器。 */
const socket = io({ autoConnect: true, reconnection: true, reconnectionAttempts: Infinity })

// F3：开发模式 HMR 热替换时关闭旧 socket，避免残留连接叠加（生产构建无影响）
if (import.meta.hot) {
  import.meta.hot.dispose(() => socket.close())
}

/** 从候选数组中随机取一个元素（用于随机昵称/头像色。 */
function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T
}

/** 从 localStorage 加载本地资料；损坏或过期时回退到随机资料。 */
function loadProfile(): StoredProfile {
  try {
    const stored = localStorage.getItem(APP_CONFIG.app.storageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<StoredProfile>
      // 头像色必须是合法 #RRGGBB，否则随机换一个预设色
      const avatarColor = new RegExp(APP_CONFIG.player.colorPattern).test(parsed.avatarColor ?? '')
        ? (parsed.avatarColor ?? APP_CONFIG.player.defaultAvatarColor)
        : randomItem(APP_CONFIG.player.avatarColors)
      if (typeof parsed.nickname === 'string') {
        return {
          nickname: parsed.nickname,
          avatarColor,
          // 恢复令牌未过期才保留，过期则下次注册为全新身份
          ...(parsed.recoveryToken &&
          parsed.recoveryTokenExpiresAt &&
          parsed.recoveryTokenExpiresAt > Date.now()
            ? {
                recoveryToken: parsed.recoveryToken,
                recoveryTokenExpiresAt: parsed.recoveryTokenExpiresAt,
              }
            : {}),
        }
      }
    }
  } catch {
    // 本地存储损坏时安全回退到随机资料，不阻止玩家进入。
  }
  return {
    nickname: randomItem(APP_CONFIG.player.defaultNicknames),
    avatarColor: randomItem(APP_CONFIG.player.avatarColors),
  }
}

/** 从 localStorage 加载本地设置；缺失字段回退默认值，非法快捷键逐项修复。 */
function loadSettings(): LocalSettings {
  try {
    const stored = localStorage.getItem(APP_CONFIG.app.settingsStorageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<LocalSettings>
      // 只复制当前配置声明的键，自动移除旧版本已经废弃的本地偏好。
      const loaded = Object.fromEntries(
        Object.entries(PUBLIC_CONFIG.localSettings).map(([key, fallback]) => [
          key,
          parsed[key as keyof LocalSettings] ?? fallback,
        ]),
      ) as LocalSettings
      // 快捷键必须是互不重复的单个可打印字符；损坏或旧版值逐项回退默认配置。
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
    // 设置损坏不属于游戏状态错误，恢复默认值即可。
  }
  return { ...PUBLIC_CONFIG.localSettings }
}

/**
 * 全局游戏 store：客户端视图状态与 Socket gateway。
 * Pinia 只保存服务端裁剪后的快照及本地偏好；所有影响胜负的操作都作为请求发送给权威服务端，
 * 服务端裁决后再通过 roomSnapshot 等推送事件回写本地状态。
 */
export const useGameStore = defineStore('game', () => {
  // ---- 本地持久化状态 ----
  const profile = ref<StoredProfile>(loadProfile()) // 本地资料（昵称/头像/恢复令牌）
  const settings = ref<LocalSettings>(loadSettings()) // 本地设置（音量/快捷键/偏好）
  // ---- 会话与连接状态 ----
  const playerId = ref('') // 服务端签发的玩家 ID（登录后才有）
  const page = ref<ShellPage>('profile') // 当前页面：资料/大厅/设置
  const connected = ref(socket.connected) // 是否已连接
  const connectionLabel = ref<ConnectionLabel>('正在连接') // 连接状态文案
  const latency = ref(0) // 最近一次往返延迟（毫秒）
  const clockOffset = ref(0) // 客户端与服务端时钟偏移（ms，服务端时间 - 本地时间），用于倒计时校正
  // ---- 服务端同步状态 ----
  const presence = ref<PresenceSnapshot>({ players: [], rooms: [] }) // 大厅在线玩家与房间列表
  const room = ref<RoomSnapshot>() // 当前房间快照（含对局视图）
  const vocabulary = ref<VocabularySnapshot>() // 词库快照（仅房主）
  const invites = ref<Invite[]>([]) // 收到的邀请列表
  const toasts = ref<Array<{ id: string; type: 'success' | 'warning' | 'error'; text: string }>>([]) // Toast 通知队列
  const busy = ref(false) // 注册/请求进行中的忙碌标记

  // 派生状态：便捷读取当前玩家在房间中的角色
  const me = computed(() => room.value?.members.find((member) => member.id === playerId.value))
  const isHost = computed(() => room.value?.hostId === playerId.value)
  const isDrawer = computed(() => room.value?.game?.drawerId === playerId.value)

  /** 弹出 Toast 通知，指定时长后自动移除。 */
  function notify(text: string, type: 'success' | 'warning' | 'error' = 'success'): void {
    const id = createUuid()
    toasts.value.push({ id, type, text })
    window.setTimeout(
      () => (toasts.value = toasts.value.filter((toast) => toast.id !== id)),
      APP_CONFIG.ui.toastDurationMs,
    )
  }

  /** 手动关闭指定 Toast；竞态下若该条已超时移除则安全忽略（避免 splice(-1)）。 */
  function dismissToast(id: string): void {
    const index = toasts.value.findIndex((toast) => toast.id === id)
    if (index !== -1) toasts.value.splice(index, 1)
  }

  /** 所有可失败请求使用 timeout + ack，并在这里统一翻译网络失败。quiet 请求（绘图高频事件）失败时不弹 Toast 刷屏。 */
  async function request<T>(
    event: string,
    payload: Record<string, unknown> = {},
    options: { quiet?: boolean } = {},
  ): Promise<T> {
    const requestId = createUuid()
    try {
      const ack = (await socket
        .timeout(APP_CONFIG.network.requestTimeoutMs)
        .emitWithAck(event, { ...payload, requestId })) as Ack<T>
      if (!ack.ok) throw new Error(ack.error.message)
      return ack.data
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '请求失败，请检查主机服务与局域网连接'
      const timeoutMessage = message.includes('operation has timed out')
        ? '服务器响应超时；当前操作未确认，请检查连接后重试'
        : message
      // D5：绘图等高频事件失败时静默降级（本地画面由下一次权威快照校准），避免连续错误 Toast 刷屏
      if (!options.quiet) notify(timeoutMessage, 'error')
      throw error
    }
  }

  async function register(): Promise<void> {
    if (!socket.connected) {
      notify('尚未连接到主机服务，请稍候再试', 'warning')
      return
    }
    busy.value = true
    try {
      const result = await request<{
        player: { id: string; nickname: string; avatarColor: string }
        recoveryToken: string
        restored: boolean
      }>(EVENTS.sessionRegister, {
        protocolVersion: APP_CONFIG.app.protocolVersion,
        profile: { nickname: profile.value.nickname, avatarColor: profile.value.avatarColor },
        preferences: {
          discoverable: settings.value.discoverable,
          acceptsInvites: settings.value.acceptsInvites,
        },
        ...(profile.value.recoveryToken ? { recoveryToken: profile.value.recoveryToken } : {}),
      })
      playerId.value = result.player.id
      profile.value = {
        ...profile.value,
        nickname: result.player.nickname,
        avatarColor: result.player.avatarColor,
        recoveryToken: result.recoveryToken,
        recoveryTokenExpiresAt: Date.now() + PUBLIC_CONFIG.network.recoveryTokenLifetimeMs,
      }
      saveProfile()
      page.value = 'lobby'
      notify(result.restored ? '座位与对局状态已恢复' : '已进入在线大厅')
    } finally {
      busy.value = false
    }
  }

  /** 保存本地资料到 localStorage。 */
  function saveProfile(): void {
    localStorage.setItem(APP_CONFIG.app.storageKey, JSON.stringify(profile.value))
  }

  /** 保存本地设置：持久化、切换色觉友好样式、同步发现/邀请偏好到服务端。 */
  function saveSettings(): void {
    localStorage.setItem(APP_CONFIG.app.settingsStorageKey, JSON.stringify(settings.value))
    // 色觉友好调色板通过根元素 class 切换（见 style.css）
    document.documentElement.classList.toggle('color-friendly', settings.value.colorFriendly)
    // 登录后把发现/邀请偏好推送给服务端
    if (playerId.value)
      void request(EVENTS.presenceUpdatePreferences, {
        discoverable: settings.value.discoverable,
        acceptsInvites: settings.value.acceptsInvites,
      })
  }

  /** 恢复本地设置为默认值并持久化。 */
  function resetSettings(): void {
    settings.value = { ...PUBLIC_CONFIG.localSettings }
    saveSettings()
    notify('本地设置已恢复默认')
  }

  /** 清除本地资料：先通知服务端离开房间释放座位（防止占座至宽限期结束），再重置本地状态。 */
  async function clearProfile(): Promise<void> {
    if (playerId.value) {
      try {
        await request(EVENTS.roomLeave)
      } catch {
        // 退出失败不阻塞清除；服务端会按 120s 宽限最终清理身份
      }
    }
    localStorage.removeItem(APP_CONFIG.app.storageKey)
    profile.value = loadProfile()
    playerId.value = ''
    room.value = undefined
    page.value = 'profile'
    notify('本地资料已清除；刷新后将作为新玩家进入', 'warning')
  }

  /** 向服务端提交资料修改（不影响当前房间状态）。 */
  async function updateProfile(): Promise<void> {
    const result = await request<{ nickname: string; avatarColor: string }>(
      EVENTS.sessionUpdateProfile,
      { profile: { nickname: profile.value.nickname, avatarColor: profile.value.avatarColor } },
    )
    profile.value = { ...profile.value, ...result }
    saveProfile()
    notify('玩家资料已更新')
  }

  /** 创建公开房间并把本地 room 状态设为服务端返回的快照。 */
  async function createRoom(input: { name: string; settings: RoomSettings }): Promise<void> {
    room.value = await request(EVENTS.roomCreate, input)
  }

  /** 加入公开房间并把本地 room 状态设为服务端返回的快照。 */
  async function joinRoom(roomId: string): Promise<void> {
    room.value = await request(EVENTS.roomJoin, { roomId })
  }

  /** 退出当前房间并清理本地对局/词库状态。 */
  async function leaveRoom(): Promise<void> {
    await request(EVENTS.roomLeave)
    room.value = undefined
    vocabulary.value = undefined
    notify('已安全退出房间')
  }

  /** 切换自己在本局的准备状态。 */
  async function setReady(ready: boolean): Promise<void> {
    await request(EVENTS.roomSetReady, { ready })
  }

  /** 房主更新房间规则（带乐观并发版本号）。 */
  async function updateRoomSettings(patch: Partial<RoomSettings>): Promise<void> {
    if (!room.value) return
    await request(EVENTS.roomUpdateSettings, { patch, expectedVersion: room.value.stateVersion })
  }

  /** 房主拉取词库快照。 */
  async function loadVocabulary(): Promise<void> {
    vocabulary.value = await request(EVENTS.roomGetVocabulary)
  }

  /** 房主保存本局词库选择（带版本号，失败会提示重新确认）。 */
  async function saveVocabulary(ids: string[]): Promise<void> {
    if (!room.value) return
    vocabulary.value = await request(EVENTS.roomUpdateVocabulary, {
      ids,
      expectedVersion: room.value.stateVersion,
    })
    notify('本局词库已更新，所有人需要重新准备')
  }

  /** 房主开始游戏（服务端校验全员准备与规则）。 */
  async function startGame(): Promise<void> {
    if (!room.value) return
    await request(EVENTS.gameStart, { expectedVersion: room.value.stateVersion })
  }

  /** 当前画家选择候选词。 */
  async function chooseWord(wordId: string): Promise<void> {
    if (!room.value?.game) return
    await request(EVENTS.gameChooseWord, { roundId: room.value.game.roundId, wordId })
  }

  /** 提交猜词文本（服务端判定正确/接近）。 */
  async function submitGuess(text: string): Promise<void> {
    if (!room.value?.game) return
    await request(EVENTS.guessSubmit, { roundId: room.value.game.roundId, text })
  }

  /** 发送安全预设互动短语。 */
  async function sendPreset(preset: string): Promise<void> {
    if (!room.value?.game) return
    await request(EVENTS.chatPreset, { roundId: room.value.game.roundId, preset })
  }

  /** 提交自由笔画批次（本地画布已即时预览，服务端校验后广播纠正；失败静默降级）。 */
  async function sendStroke(stroke: Stroke): Promise<void> {
    if (!room.value?.game) return
    await request(
      EVENTS.drawStrokeBatch,
      { roundId: room.value.game.roundId, stroke },
      { quiet: true },
    )
  }

  /** 填充点击作为单条命令提交，服务端验证后才进入共享绘图历史；失败静默降级。 */
  async function sendFill(fill: FillCommand): Promise<void> {
    if (!room.value?.game) return
    await request(
      EVENTS.drawFillCommit,
      { roundId: room.value.game.roundId, fill },
      { quiet: true },
    )
  }

  /** 通用绘图动作：撤销/重做/清空（低频，但失败也静默降级避免刷屏）。 */
  async function drawAction(event: string): Promise<void> {
    if (!room.value?.game) return
    await request(event, { roundId: room.value.game.roundId }, { quiet: true })
  }

  // 房主控制动作：暂停 / 恢复 / 提前结束 / 返回房间 / 踢人 / 移交房主
  async function pause(reason = '房主暂停了游戏'): Promise<void> {
    await request(EVENTS.gamePauseRequest, { reason })
  }
  async function resume(): Promise<void> {
    await request(EVENTS.gameResume)
  }
  async function endEarly(): Promise<void> {
    await request(EVENTS.gameEndEarly)
  }
  async function returnWaiting(): Promise<void> {
    await request(EVENTS.gameReturnWaiting)
  }
  async function kick(targetId: string): Promise<void> {
    await request(EVENTS.roomKick, { targetId })
  }
  async function transferHost(targetId: string): Promise<void> {
    await request(EVENTS.roomTransferHost, { targetId })
  }

  /** 向指定在线玩家发送定向房间邀请。 */
  async function invite(targetId: string): Promise<void> {
    await request(EVENTS.inviteSend, { targetId })
    notify('邀请已发送')
  }

  /** 接受/拒绝邀请；接受成功后切换到受邀房间。 */
  async function respondInvite(inviteId: string, accept: boolean): Promise<void> {
    const joined = await request<RoomSnapshot | undefined>(EVENTS.inviteRespond, {
      inviteId,
      accept,
    })
    invites.value = invites.value.filter((invite) => invite.id !== inviteId)
    if (joined) room.value = joined
  }

  /**
   * 注册全部服务端推送事件的监听器（全局唯一的连接生命周期）。
   * 注意：绘图增量事件在这里按回合 ID 与序号直接合并进本地历史，无需等待下一次快照。
   */
  function attachSocketListeners(): void {
    // 连接成功：更新标签；若已有身份或恢复令牌则自动重新注册
    socket.on('connect', () => {
      connected.value = true
      connectionLabel.value = '已连接'
      if (playerId.value || profile.value.recoveryToken) void register()
    })
    // 断开：服务端主动断开视为不可恢复，否则进入重连
    socket.on('disconnect', (reason) => {
      connected.value = false
      connectionLabel.value = reason === 'io server disconnect' ? '无法连接' : '正在重连'
    })
    socket.io.on('reconnect_attempt', () => (connectionLabel.value = '正在重连'))
    socket.io.on('error', () => (connectionLabel.value = '连接不稳定'))
    // 大厅同步：完整在线快照与增量房间列表
    socket.on(EVENTS.presenceSnapshot, (snapshot: PresenceSnapshot) => (presence.value = snapshot))
    socket.on(EVENTS.roomListChanged, (rooms: PublicRoom[]) => (presence.value.rooms = rooms))
    // 房间快照：服务端按角色裁剪后推送，直接替换本地 room 状态
    // 房间快照：服务端按角色裁剪后推送，直接替换本地 room 状态。
    // E4：快照标记 strokesOmitted 时沿用本地已有画布历史（服务端已用增量补齐），避免画布闪空
    socket.on(EVENTS.roomSnapshot, (snapshot: RoomSnapshot) => {
      if (snapshot.game?.strokesOmitted) {
        const previous = room.value?.game?.strokes ?? []
        snapshot = {
          ...snapshot,
          game: { ...snapshot.game, strokes: previous, strokesOmitted: false },
        }
      }
      room.value = snapshot
    })
    // 收到邀请：加入邀请列表并弹出通知
    socket.on(EVENTS.inviteReceived, (invite: Invite) => {
      invites.value.push(invite)
      notify(`${invite.from.nickname} 邀请你加入“${invite.roomName}”`, 'warning')
    })
    // 邀请被处理（接受/拒绝/过期）：从本地队列移除
    socket.on(
      EVENTS.inviteResolved,
      ({ id }: { id: string }) =>
        (invites.value = invites.value.filter((invite) => invite.id !== id)),
    )
    // 房间被踢/关闭：清空本地房间并通知原因
    socket.on(EVENTS.roomClosed, ({ reason }: { reason: string }) => {
      room.value = undefined
      notify(reason, 'warning')
    })
    socket.on(EVENTS.systemNotice, ({ text }: { text: string }) => notify(text, 'warning'))
    socket.on(EVENTS.systemError, ({ message }: { message: string }) => notify(message, 'error'))
    // 笔画增量：按回合 ID 过滤，同笔画 ID 追加点，新笔画创建命令
    socket.on(
      EVENTS.drawStrokeBatch,
      ({ roundId, stroke }: { roundId: string; stroke: Stroke }) => {
        const game = room.value?.game
        if (!game || game.roundId !== roundId) return
        const existing = game.strokes.find(
          (item): item is Stroke => item.kind === 'stroke' && item.id === stroke.id,
        )
        if (existing) {
          if (stroke.sequence <= existing.sequence) return // 丢弃旧序号包
          existing.points.push(...stroke.points)
          existing.sequence = stroke.sequence
        } else game.strokes.push({ ...stroke, points: [...stroke.points] })
      },
    )
    // 填充增量：按回合 ID 与命令 ID 去重后追加
    socket.on(
      EVENTS.drawFillCommit,
      ({ roundId, fill }: { roundId: string; fill: FillCommand }) => {
        const game = room.value?.game
        if (!game || game.roundId !== roundId || game.strokes.some((item) => item.id === fill.id))
          return
        game.strokes.push(fill)
      },
    )
  }

  /**
   * 测量往返延迟，并顺带估算客户端与服务端的时钟偏移（F2）。
   * 局域网设备时钟偏差会导致倒计时显示不准；偏移 = serverTime - (clientTime + RTT/2)。
   */
  async function measureLatency(): Promise<void> {
    if (!playerId.value) return
    const started = Date.now()
    try {
      const result = await request<{ clientTime: number; serverTime: number }>(
        EVENTS.networkPing,
        { clientTime: started },
        { quiet: true },
      )
      const rtt = Date.now() - started
      latency.value = Math.max(0, rtt)
      clockOffset.value = result.serverTime - (started + rtt / 2)
    } catch {
      // 网络抖动时静默忽略，沿用上一次估算值
    }
  }

  // store 初始化：注册监听、应用本地设置、消除热刷新注册竞态、启动延迟探测定时器
  attachSocketListeners()
  saveSettings()
  // 热刷新或页面重载时 Socket 可能先于 store 完成连接；主动恢复可消除这一竞态。
  if (socket.connected && profile.value.recoveryToken) queueMicrotask(() => void register())
  window.setInterval(() => void measureLatency(), APP_CONFIG.network.pingIntervalMs)

  return {
    config: PUBLIC_CONFIG,
    profile,
    settings,
    playerId,
    page,
    connected,
    connectionLabel,
    latency,
    clockOffset,
    presence,
    room,
    vocabulary,
    invites,
    toasts,
    busy,
    me,
    isHost,
    isDrawer,
    notify,
    dismissToast,
    register,
    saveProfile,
    saveSettings,
    resetSettings,
    clearProfile,
    updateProfile,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    updateRoomSettings,
    loadVocabulary,
    saveVocabulary,
    startGame,
    chooseWord,
    submitGuess,
    sendPreset,
    sendStroke,
    sendFill,
    drawAction,
    pause,
    resume,
    endEarly,
    returnWaiting,
    kick,
    transferHost,
    invite,
    respondInvite,
  }
})
