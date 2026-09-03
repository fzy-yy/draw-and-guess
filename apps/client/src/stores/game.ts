/**
 * 客户端视图状态与 Socket gateway。
 * Pinia 只保存服务端裁剪后的快照及本地偏好；所有影响胜负的操作都作为请求发送给权威服务端。
 * 连接单例与请求封装分别收敛到 ./socket.ts 与 ./request.ts。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import { strings, serverStrings } from '@draw-guess/strings'
import {
  EVENTS,
  RecoveryTokenSchema,
  type FillCommand,
  type Invite,
  type MemberConnectionChange,
  type PresenceSnapshot,
  type Profile,
  type RoomSettings,
  type RoomSnapshot,
  type RoomVisibility,
  type SessionRegistration,
  type Stroke,
  type VocabularySnapshot,
} from '@draw-guess/shared'
import { toast } from 'vue-sonner'
import { attachSocketListeners, socket } from './socket.ts'
import { createRequester, type RequestResult } from './request.ts'

/** 连接状态文案类型：与 config/strings.ts 的 strings.connection 保持同一来源，改动文案无需另改类型。 */
export type ConnectionLabel = (typeof strings.connection)[keyof typeof strings.connection]
export type ShellPage = 'profile' | 'lobby' | 'settings'
/** 传输连接与应用会话分离：Socket 已连接不代表身份/房间/画布已恢复完成。 */
export type SessionState = 'idle' | 'ready' | 'disconnected' | 'restoring'

interface StoredProfile extends Profile {
  /** 只有服务端签发且不会公开的恢复令牌可用于接管既有 UUID 身份。 */
  recoveryToken?: string
}

/** 将只读配置默认值拓宽为可编辑的本地设置类型，允许用户自定义快捷键字符。 */
type LocalSettings = {
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

/** 从候选数组中随机取一个元素（用于随机昵称和内置头像）。 */
function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T
}

/** 从 localStorage 加载本地资料；损坏时回退到随机资料。 */
function loadProfile(): StoredProfile {
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
        // 恢复令牌的有效窗口从「实际断线时刻」起由服务端权威计算，客户端不能按签发时间自作主张删除。
        // 仅复用共享 schema 排除损坏存储；旧版 recoveryTokenExpiresAt 字段会在下次保存时自动迁移掉。
        const token = RecoveryTokenSchema.safeParse(parsed.recoveryToken)
        return token.success ? { ...base, recoveryToken: token.data } : base
      }
    }
  } catch {
    // 本地存储损坏时安全回退到随机资料，不阻止玩家进入。
  }
  return {
    nickname: randomItem(APP_CONFIG.player.defaultNicknames),
    avatarId: randomItem(APP_CONFIG.player.avatarIds),
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
      // 布尔/音量字段逐项校验，避免损坏存储中的字符串“false”被当作已开启。
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
  const connected = ref(socket.connected) // Socket 传输层是否已连接
  const sessionState = ref<SessionState>(profile.value.recoveryToken ? 'restoring' : 'idle') // 应用会话是否完成身份与权威房间同步
  const connectionLabel = ref<ConnectionLabel>(strings.connection.connecting) // 连接状态文案
  const latency = ref(0) // 最近一次往返延迟（毫秒）
  const clockOffset = ref(0) // 客户端与服务端时钟偏移（ms，服务端时间 - 本地时间），用于倒计时校正
  // ---- 服务端同步状态 ----
  const presence = ref<PresenceSnapshot>({ players: [], rooms: [] }) // 大厅在线玩家与房间列表
  const room = ref<RoomSnapshot>() // 当前房间快照（含对局视图）
  const vocabulary = ref<VocabularySnapshot>() // 词库快照（仅房主）
  const invites = ref<Invite[]>([]) // 收到的邀请列表
  /** 被房主移出房间的待确认标记：置位后由根舞台弹出提示对话框，确认后复位。 */
  const kickedNotice = ref(false)
  /** 画布渲染代次：每次收到笔画追加/新命令时递增，供画布组件可靠触发增量绘制。 */
  const drawRevision = ref(0)
  const busy = ref(false) // 注册/请求进行中的忙碌标记
  let restoreRetryTimer: number | undefined

  // 派生状态：便捷读取当前玩家在房间中的角色
  const me = computed(() => room.value?.members.find((member) => member.id === playerId.value))
  const isHost = computed(() => room.value?.hostId === playerId.value)
  const isDrawer = computed(() => room.value?.game?.drawerId === playerId.value)

  /**
   * 弹出 Toast 通知。
   * 由 vue-sonner 接管渲染（App.vue 挂载 <Toaster/>），store 只保留统一的 `notify` 入口，
   * 把类型映射到 toast.success/error/warning，并保留「同内容防抖合并」语义：
   * 以内容+类型为稳定 id 复用同一条 toast（vue-sonner 会就地更新而非重复堆叠）。
   */
  function notify(text: string, type: 'success' | 'warning' | 'error' = 'success'): void {
    const id = `${type}:${text}` // 稳定 id：同内容+类型复用同一条，实现防抖合并
    // 映射业务类型到 vue-sonner 的方法；默认成功。
    const push = type === 'error' ? toast.error : type === 'warning' ? toast.warning : toast.success
    push(text, { id, duration: APP_CONFIG.ui.toastDurationMs })
  }

  /** 所有可失败请求使用 timeout + ack，并在这里统一翻译网络失败（实现见 stores/request.ts）。 */
  const request = createRequester({ socket, notify })

  /**
   * 执行不带向上传播的请求：失败时 request 已弹出错误 Toast，这里静默吞掉，
   * 避免 Vue 事件处理器收到未捕获 rejection 而产生页面级错误（pageerror）。
   * request 层现已不抛错（返回可判别结果），guarded 仅作为极端意外故障的兜底。
   */
  async function guarded<T>(
    promise: Promise<RequestResult<T>>,
  ): Promise<RequestResult<T> | undefined> {
    try {
      return await promise
    } catch {
      return undefined
    }
  }

  /** 清除尚未执行的会话恢复重试，保证同一时刻最多只有一次注册请求。 */
  function clearRestoreRetry(): void {
    window.clearTimeout(restoreRetryTimer)
    restoreRetryTimer = undefined
  }

  /**
   * 传输已连接但注册 ack 超时/失败时静默重试。
   * Socket.IO 此时不会再触发 connect，因此若不主动重试，页面会永久停在恢复遮罩或资料页。
   */
  function scheduleRestoreRetry(): void {
    clearRestoreRetry()
    restoreRetryTimer = window.setTimeout(() => {
      restoreRetryTimer = undefined
      if (socket.connected && sessionState.value === 'restoring') void register(true)
    }, PUBLIC_CONFIG.network.sessionRestoreRetryMs)
  }

  /** 注册新身份或凭服务端秘密令牌恢复既有 UUID；automatic=true 时失败静默重试。 */
  async function register(automatic = false): Promise<void> {
    if (busy.value) return
    if (!socket.connected) {
      if (profile.value.recoveryToken || playerId.value) sessionState.value = 'disconnected'
      if (!automatic) notify(strings.store.notConnected, 'warning')
      return
    }
    if (automatic) sessionState.value = 'restoring'
    clearRestoreRetry()
    busy.value = true
    try {
      const result = await guarded<SessionRegistration>(
        request(
          EVENTS.sessionRegister,
          {
            protocolVersion: APP_CONFIG.app.protocolVersion,
            profile: { nickname: profile.value.nickname, avatarId: profile.value.avatarId },
            preferences: {
              discoverable: settings.value.discoverable,
              acceptsInvites: settings.value.acceptsInvites,
            },
            // 只传递不会公开的恢复令牌；公开 playerId 不具备身份凭证能力。
            ...(profile.value.recoveryToken ? { recoveryToken: profile.value.recoveryToken } : {}),
          },
          { quiet: automatic },
        ),
      )
      if (!result?.ok) {
        const retryableTransportFailure = !result || !result.code
        if (automatic && profile.value.recoveryToken && retryableTransportFailure) {
          scheduleRestoreRetry()
        } else if (automatic) {
          // 协议不匹配/载荷拒绝等永久错误不能无限静默重试；退出阻断框并给出可见错误。
          sessionState.value = 'idle'
          playerId.value = ''
          room.value = undefined
          page.value = 'profile'
          notify(result?.error ?? strings.request.genericFailure, 'error')
        }
        return
      }
      playerId.value = result.data.player.id
      profile.value = {
        nickname: result.data.player.nickname,
        avatarId: result.data.player.avatarId,
        recoveryToken: result.data.recoveryToken,
      }
      saveProfile()
      // 注册 ack 原子携带权威 room|null：非作画阶段断线已被服务端离房时，必须清掉旧对局视图。
      room.value = result.data.room ?? undefined
      if (!result.data.room) vocabulary.value = undefined
      page.value = 'lobby'
      sessionState.value = 'ready'
      notify(
        result.data.restored
          ? result.data.room
            ? strings.store.gameRestored
            : strings.store.restored
          : strings.store.enteredLobby,
      )
    } finally {
      busy.value = false
    }
  }

  /** 保存本地资料到 localStorage。 */
  function saveProfile(): void {
    localStorage.setItem(APP_CONFIG.app.storageKey, JSON.stringify(profile.value))
  }

  /** 保存本地设置：持久化、切换动画状态、同步发现/邀请偏好到服务端。 */
  function saveSettings(): void {
    localStorage.setItem(APP_CONFIG.app.settingsStorageKey, JSON.stringify(settings.value))
    // 仅关闭非必要的 CSS 动画/过渡，不影响服务端倒计时、音效和画布重放。
    document.documentElement.classList.toggle('motion-disabled', !settings.value.animationsEnabled)
    // 登录后把发现/邀请偏好推送给服务端
    if (playerId.value)
      void guarded(
        request(EVENTS.presenceUpdatePreferences, {
          discoverable: settings.value.discoverable,
          acceptsInvites: settings.value.acceptsInvites,
        }),
      )
  }

  /** 恢复本地设置为默认值并持久化。 */
  function resetSettings(): void {
    settings.value = { ...PUBLIC_CONFIG.localSettings }
    saveSettings()
    notify(strings.store.settingsReset)
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
    sessionState.value = 'idle'
    clearRestoreRetry()
    page.value = 'profile'
    notify(strings.store.profileCleared, 'warning')
  }

  /** 同时重抽昵称与内置 SVG 头像；随机结果始终来自前后端共享白名单（资料页「换一组」入口）。 */
  function randomizeProfile(): void {
    profile.value = {
      ...profile.value,
      nickname: randomItem(APP_CONFIG.player.defaultNicknames),
      avatarId: randomItem(APP_CONFIG.player.avatarIds),
    }
  }

  /** 向服务端提交资料修改（不影响当前房间状态）。 */
  async function updateProfile(): Promise<void> {
    const result = await guarded<Profile>(
      request(EVENTS.sessionUpdateProfile, {
        profile: { nickname: profile.value.nickname, avatarId: profile.value.avatarId },
      }),
    )
    if (!result?.ok) return // 失败已提示，不覆盖本地资料
    profile.value = { ...profile.value, ...result.data }
    saveProfile()
    notify(strings.store.profileUpdated)
  }

  /**
   * 创建公开或私密房间；返回是否成功，供弹窗在失败时保留输入供重试。
   */
  async function createRoom(input: {
    name: string
    visibility: RoomVisibility
    settings: RoomSettings
  }): Promise<boolean> {
    const snapshot = await guarded<RoomSnapshot>(request(EVENTS.roomCreate, input))
    if (!snapshot?.ok) return false
    room.value = snapshot.data
    return true
  }
  /** 加入大厅中的公开房间；返回是否成功。 */
  async function joinRoom(roomId: string): Promise<boolean> {
    const snapshot = await guarded<RoomSnapshot>(request(EVENTS.roomJoin, { roomId }))
    if (!snapshot?.ok) return false
    room.value = snapshot.data
    return true
  }

  /** 使用服务端生成的短码加入私密房；返回是否成功，失败时弹窗保留输入供重试。 */
  async function joinPrivateRoom(code: string): Promise<boolean> {
    const snapshot = await guarded<RoomSnapshot>(request(EVENTS.roomJoinPrivate, { code }))
    if (!snapshot?.ok) return false
    room.value = snapshot.data
    return true
  }

  /** 退出当前房间并清理本地对局/词库状态。 */
  async function leaveRoom(): Promise<void> {
    // roomLeave 成功时服务端返回空 data，用 result.ok 区分“请求失败”与“成功但无数据”。
    const result = await guarded<undefined>(request(EVENTS.roomLeave))
    if (!result?.ok) return
    room.value = undefined
    vocabulary.value = undefined
    notify(strings.store.roomLeft)
  }

  /** 切换自己在本局的准备状态。 */
  async function setReady(ready: boolean): Promise<void> {
    await guarded(request(EVENTS.roomSetReady, { ready }))
  }

  /** 房主更新房间规则（带乐观并发版本号）；返回是否成功，供弹窗失败时保留草稿。 */
  async function updateRoomSettings(patch: Partial<RoomSettings>): Promise<boolean> {
    if (!room.value) return false
    const result = await guarded<RoomSnapshot>(
      request(EVENTS.roomUpdateSettings, {
        patch,
        expectedVersion: room.value.stateVersion,
      }),
    )
    return result?.ok ?? false
  }

  /** 房主拉取词库快照。 */
  async function loadVocabulary(): Promise<void> {
    const snapshot = await guarded<VocabularySnapshot>(request(EVENTS.roomGetVocabulary))
    if (snapshot?.ok) vocabulary.value = snapshot.data
  }

  /** 房主保存本局词库选择（带版本号，失败会提示重新确认）；返回是否成功供弹窗保留选择。 */
  async function saveVocabulary(ids: string[]): Promise<boolean> {
    if (!room.value) return false
    const snapshot = await guarded<VocabularySnapshot>(
      request(EVENTS.roomUpdateVocabulary, {
        ids,
        expectedVersion: room.value.stateVersion,
      }),
    )
    if (!snapshot?.ok) return false
    vocabulary.value = snapshot.data
    notify(strings.store.vocabularyUpdated)
    return true
  }

  /** 房主开始游戏（服务端校验全员准备与规则）。 */
  async function startGame(): Promise<void> {
    if (!room.value) return
    await guarded(request(EVENTS.gameStart, { expectedVersion: room.value.stateVersion }))
  }

  /** 当前画家选择候选词。 */
  async function chooseWord(wordId: string): Promise<void> {
    if (!room.value?.game) return
    await guarded(request(EVENTS.gameChooseWord, { roundId: room.value.game.roundId, wordId }))
  }

  /** 提交猜词文本（服务端判定正确/接近）；返回是否成功送达，供输入框决定要不要保留草稿。 */
  async function submitGuess(text: string): Promise<boolean> {
    if (!room.value?.game) return false
    const result = await guarded(
      request(EVENTS.guessSubmit, { roundId: room.value.game.roundId, text }),
    )
    return result?.ok ?? false
  }

  /** 发送安全预设互动短语。 */
  async function sendPreset(preset: string): Promise<void> {
    if (!room.value?.game) return
    await guarded(request(EVENTS.chatPreset, { roundId: room.value.game.roundId, preset }))
  }

  /** 提交自由笔画批次（本地画布已即时预览，服务端校验后广播纠正；失败静默降级）。 */
  async function sendStroke(stroke: Stroke): Promise<void> {
    if (!room.value?.game) return
    await guarded(
      request(
        EVENTS.drawStrokeBatch,
        { roundId: room.value.game.roundId, stroke },
        { quiet: true },
      ),
    )
  }

  /** 填充点击作为单条命令提交，服务端验证后才进入共享绘图历史；失败静默降级。 */
  async function sendFill(fill: FillCommand): Promise<void> {
    if (!room.value?.game) return
    await guarded(
      request(EVENTS.drawFillCommit, { roundId: room.value.game.roundId, fill }, { quiet: true }),
    )
  }

  /** 通用绘图动作：撤销/重做/清空（低频，但失败也静默降级避免刷屏）。 */
  async function drawAction(event: string): Promise<void> {
    if (!room.value?.game) return
    await guarded(request(event, { roundId: room.value.game.roundId }, { quiet: true }))
  }

  // 房主控制动作：暂停 / 恢复 / 提前结束 / 返回房间 / 踢人 / 移交房主
  async function pause(reason: string = strings.store.pauseReasonHost): Promise<void> {
    await guarded(request(EVENTS.gamePauseRequest, { reason }))
  }
  async function resume(): Promise<void> {
    await guarded(request(EVENTS.gameResume))
  }
  async function endEarly(): Promise<void> {
    await guarded(request(EVENTS.gameEndEarly))
  }
  /** 主动退出当前对局并返回大厅；服务端仍为其他玩家保留本局灰色成绩卡。 */
  async function leaveGame(): Promise<void> {
    const result = await guarded<undefined>(request(EVENTS.gameLeave))
    if (!result?.ok) return
    room.value = undefined
    vocabulary.value = undefined
    page.value = 'lobby'
    notify(strings.store.roomLeft)
  }
  async function returnWaiting(): Promise<void> {
    await guarded(request(EVENTS.gameReturnWaiting))
  }
  async function kick(targetId: string): Promise<void> {
    await guarded(request(EVENTS.roomKick, { targetId }))
  }

  /** 向指定在线玩家发送定向房间邀请。 */
  async function invite(targetId: string): Promise<void> {
    const result = await guarded<Invite>(request(EVENTS.inviteSend, { targetId }))
    if (!result?.ok) return
    notify(strings.store.inviteSent)
  }

  /** 接受/拒绝邀请；接受成功后切换到受邀房间。 */
  async function respondInvite(inviteId: string, accept: boolean): Promise<void> {
    // 拒绝时服务端返回 undefined 仍属成功，用 result.ok 区分失败与成功但无数据。
    const joined = await guarded<RoomSnapshot | undefined>(
      request<RoomSnapshot | undefined>(EVENTS.inviteRespond, {
        inviteId,
        accept,
      }),
    )
    if (!joined?.ok) return
    invites.value = invites.value.filter((invite) => invite.id !== inviteId)
    if (joined.data) room.value = joined.data
  }

  /**
   * 注册全部服务端推送事件的监听器（全局唯一的连接生命周期）。
   * 注意：绘图增量事件在这里按回合 ID 与序号直接合并进本地历史，无需等待下一次快照。
   */
  /** 全量重同步进行中标记：防止断线修复期间多个 stateResync 并发覆盖（见 onRoomSnapshot）。 */
  let resyncInFlight = false
  /** 注册服务端推送事件：把 socket.ts 的回调桥接回本地 refs（绘图增量合并见 socket.ts 约定）。 */
  const detachSocketListeners = attachSocketListeners({
    onConnect: () => {
      connected.value = true
      connectionLabel.value = strings.connection.connected
      // Socket 传输恢复不等于会话恢复：有本机令牌/身份时保持阻断遮罩，直到注册 ack 同步 room|null。
      if (playerId.value || profile.value.recoveryToken) {
        sessionState.value = 'restoring'
        void register(true)
      }
    },
    onDisconnect: (reason) => {
      connected.value = false
      clearRestoreRetry()
      // 服务端主动断开（io server disconnect）在本项目只发生在「会话被新连接接管」
      // （reclaimPlayer 挤掉旧 socket）与「服务优雅关闭」两种场景；此时自动重连会与
      // 接管方互相挤掉形成乒乓，因此不重连、不放恢复遮罩，而是结束本地会话回到资料页：
      // 用户在本窗口重新点「进入」即可凭恢复令牌接管回来（后到者赢，与接管语义一致）。
      if (reason === 'io server disconnect' && (playerId.value || profile.value.recoveryToken)) {
        sessionState.value = 'idle'
        room.value = undefined
        vocabulary.value = undefined
        page.value = 'profile'
        // 该分支提前 return，此前漏更新连接文案：connected 已置 false，但标签仍是「已连接」，
        // 资料页会出现红色 WifiOff 图标 +「已连接」的自相矛盾展示（标注截图中的 bug）。
        // 此场景服务端不再自动重连，标签固定为「未连接」，直到用户手动重新进入。
        connectionLabel.value = strings.connection.disconnected
        notify(strings.store.sessionTakenOver, 'warning')
        return
      }
      if (playerId.value || profile.value.recoveryToken) sessionState.value = 'disconnected'
      connectionLabel.value =
        reason === 'io server disconnect'
          ? strings.connection.unavailable
          : strings.connection.reconnecting
    },
    onReconnectAttempt: () => {
      connectionLabel.value = strings.connection.reconnecting
      if (playerId.value || profile.value.recoveryToken) sessionState.value = 'disconnected'
    },
    onIoError: () => {
      connectionLabel.value = strings.connection.unstable
      if (!socket.connected && (playerId.value || profile.value.recoveryToken))
        sessionState.value = 'disconnected'
    },
    onPresence: (snapshot) => (presence.value = snapshot),
    onRooms: (rooms) => (presence.value.rooms = rooms),
    // E4：快照标记 strokesOmitted 时沿用本地已有画布历史（服务端已用增量补齐），避免画布闪空。
    // 若本地落后于权威 lastSequence（曾丢失过增量广播），主动拉一次全量快照修复画面一致性。
    onRoomSnapshot: (snapshot) => {
      if (snapshot.game?.strokesOmitted) {
        const localStrokes = room.value?.game?.strokes ?? []
        const localMaxSequence = localStrokes.reduce(
          (max, command) => Math.max(max, command.sequence),
          -1,
        )
        if (localMaxSequence < snapshot.game.lastSequence) {
          // 中途丢过笔画增量：请求全量画布历史（stateResync 服务端会强制全量下发）。
          // 失败时保留当前 room（服务端已弹错误提示），避免画布状态不一致却无任何反馈。
          // 在修复返回前继续应用后续快照/增量（保持本地推进），返回时按序号判断是否仍落后，
          // 只有仍落后才覆盖，避免旧的并发响应回滚到过期状态。
          if (!resyncInFlight) {
            resyncInFlight = true
            void guarded<RoomSnapshot | undefined>(request(EVENTS.stateResync, {})).then((full) => {
              resyncInFlight = false
              const fullSnapshot = full?.ok ? full.data : undefined
              if (!fullSnapshot?.game) return
              const current = room.value?.game
              const currentMaxSequence =
                current?.strokes.reduce((max, command) => Math.max(max, command.sequence), -1) ?? -1
              if (currentMaxSequence >= fullSnapshot.game.lastSequence) return // 已追上，丢弃过期全量
              room.value = fullSnapshot
            })
          }
          return // 修正结果以全量快照为准，当前这份残缺快照不落入本地
        }
        snapshot = {
          ...snapshot,
          game: { ...snapshot.game, strokes: localStrokes, strokesOmitted: false },
        }
      }
      room.value = snapshot
    },
    onMemberConnectionChanged: (change: MemberConnectionChange) => {
      // 服务端仅在作画阶段保留席位时广播；排除本人（本人使用不可关闭的恢复模态框）。
      if (change.playerId === playerId.value || change.playerId === '') return
      if (change.connection === 'left') {
        notify(strings.store.memberLeftGame(change.nickname), 'warning')
        return
      }
      notify(
        change.connection === 'reconnecting'
          ? strings.store.memberDisconnected(change.nickname)
          : strings.store.memberReconnected(change.nickname),
        change.connection === 'reconnecting' ? 'warning' : 'success',
      )
    },
    onInviteReceived: (invite) => {
      invites.value.push(invite)
      notify(strings.app.inviteReceived(invite.from.nickname, invite.roomName), 'warning')
    },
    onInviteResolved: (id) => (invites.value = invites.value.filter((invite) => invite.id !== id)),
    onRoomClosed: (reason) => {
      room.value = undefined
      // 与 leaveRoom/leaveGame 保持一致：房间关闭时同样清空词库快照，
      // 避免跨房间残留旧词库（词库仅房主可见，残留会造成规则/词库展示错误）。
      vocabulary.value = undefined
      // 被房主移出：不用一闪而过的 Toast，改弹模态对话框确保玩家知晓被踢原因。
      if (reason === serverStrings.notices.kickedReason) {
        kickedNotice.value = true
        return
      }
      notify(reason, 'warning')
    },
    onSystemNotice: (text) => notify(text, 'warning'),
    // “很接近”提示：服务端只单播给猜词者本人且不写入聊天流，
    // 此前客户端未监听该事件，导致房主开启“近似答案提示”规则后玩家得零反馈。
    onGuessClose: (text) => notify(text, 'warning'),
    onSystemError: (message) => notify(message, 'error'),
    // 笔画增量：按回合 ID 过滤，同笔画 ID 追加点（丢弃旧序号包），新笔画创建命令
    onDrawStrokeBatch: (roundId, stroke) => {
      const game = room.value?.game
      if (!game || game.roundId !== roundId) return
      const existing = game.strokes.find(
        (item): item is Stroke => item.kind === 'stroke' && item.id === stroke.id,
      )
      if (existing) {
        if (stroke.sequence <= existing.sequence) return
        existing.points.push(...stroke.points)
        existing.sequence = stroke.sequence
      } else {
        game.strokes.push({ ...stroke, points: [...stroke.points] })
        // 与服务端权威历史对齐：命令数同样截断，避免本地历史无限增长（内存有界）
        if (game.strokes.length > APP_CONFIG.drawing.maxHistoryCommands) game.strokes.shift()
      }
      // 与服务端 addStroke 的撤销语义保持一致：任何被接受的新命令都会使重做失效，
      // 且此前被撤销的命令被永久丢弃（而不是重新显示）——否则继续作画时，
      // 被撤销的内容会突然回来，与画家预期不符。服务端在物理移除时只广播命令增量、
      // 不推送快照，因此客户端必须按同一命令流在本地做同样的移除，两端才能一致。
      //
      if (game.undoneStrokeIds.length) {
        const undoneSet = new Set(game.undoneStrokeIds)
        game.strokes = game.strokes.filter((command) => !undoneSet.has(command.id))
        game.undoneStrokeIds = []
      }
      // 同 ID 追加不改变命令数组长度/撤销状态，普通 watch 不会触发；
      // 用显式绘制代次让画布组件可靠增量绘制长笔画的后续批次。
      drawRevision.value += 1
    },
    // 填充增量：按回合 ID 与命令 ID 去重后追加；同样执行历史上限截断。
    // 与笔画增量同理：新命令到达时按同一撤销语义物理移除被撤销命令（详见上方注释）。
    onDrawFillCommit: (roundId, fill) => {
      const game = room.value?.game
      if (!game || game.roundId !== roundId || game.strokes.some((item) => item.id === fill.id))
        return
      if (game.undoneStrokeIds.length) {
        const undoneSet = new Set(game.undoneStrokeIds)
        game.strokes = game.strokes.filter((command) => !undoneSet.has(command.id))
        game.undoneStrokeIds = []
      }
      game.strokes.push(fill)
      if (game.strokes.length > APP_CONFIG.drawing.maxHistoryCommands) game.strokes.shift()
      drawRevision.value += 1
    },
  })

  /**
   * 测量往返延迟，并顺带估算客户端与服务端的时钟偏移（F2）。
   * 局域网设备时钟偏差会导致倒计时显示不准；偏移 = serverTime - (clientTime + RTT/2)。
   */
  async function measureLatency(): Promise<void> {
    if (!playerId.value) return
    const started = Date.now()
    const result = await request<{ clientTime: number; serverTime: number }>(
      EVENTS.networkPing,
      { clientTime: started },
      { quiet: true },
    )
    // 网络抖动或超时失败时静默忽略（quiet 请求不弹 Toast），沿用上一次估算值
    if (!result.ok) return
    const rtt = Date.now() - started
    latency.value = Math.max(0, rtt)
    clockOffset.value = result.data.serverTime - (started + rtt / 2)
  }

  // store 初始化：注册监听、应用本地设置、消除热刷新注册竞态、启动延迟探测定时器
  saveSettings()
  // 热刷新或页面重载时 Socket 可能先于 store 完成连接；主动恢复可消除这一竞态。
  if (socket.connected && profile.value.recoveryToken) queueMicrotask(() => void register(true))
  const pingTimer = window.setInterval(
    () => void measureLatency(),
    APP_CONFIG.network.pingIntervalMs,
  )

  // 开发态 HMR：成对清理探测定时器与推送监听。否则 store 闭包会持有已被 dispose 的旧 socket，
  // 导致服务端推送不再驱动 UI；若 store setup 被重复执行还会出现重复监听与多个定时器。
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.clearInterval(pingTimer)
      clearRestoreRetry()
      detachSocketListeners()
    })
  }

  return {
    config: PUBLIC_CONFIG,
    profile,
    settings,
    playerId,
    page,
    connected,
    sessionState,
    connectionLabel,
    latency,
    clockOffset,
    presence,
    room,
    vocabulary,
    invites,
    kickedNotice,
    drawRevision,
    busy,
    me,
    isHost,
    isDrawer,
    notify,
    register,
    randomizeProfile,
    saveSettings,
    resetSettings,
    clearProfile,
    updateProfile,
    createRoom,
    joinRoom,
    joinPrivateRoom,
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
    leaveGame,
    returnWaiting,
    kick,
    invite,
    respondInvite,
    /** 确认被踢提示对话框（复位标记，关闭弹窗）。 */
    dismissKickedNotice() {
      kickedNotice.value = false
    },
  }
})
