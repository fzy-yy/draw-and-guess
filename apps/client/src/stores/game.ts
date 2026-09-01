/**
 * 客户端视图状态与 Socket gateway。
 * Pinia 只保存服务端裁剪后的快照及本地偏好；所有影响胜负的操作都作为请求发送给权威服务端。
 * 连接单例与请求封装分别收敛到 ./socket.ts 与 ./request.ts。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import {
  EVENTS,
  type FillCommand,
  type Invite,
  type PresenceSnapshot,
  type Profile,
  type RoomSettings,
  type RoomSnapshot,
  type RoomVisibility,
  type Stroke,
  type VocabularySnapshot,
} from '@draw-guess/shared'
import { createUuid } from '@/utils/createUuid'
import { attachSocketListeners, socket } from './socket.ts'
import { createRequester } from './request.ts'

/** 连接状态文案类型：与 config/strings.ts 的 strings.connection 保持同一来源，改动文案无需另改类型。 */
export type ConnectionLabel = (typeof strings.connection)[keyof typeof strings.connection]
export type ShellPage = 'profile' | 'lobby' | 'settings'

interface StoredProfile extends Profile {
  /** 只有服务端签发且不会公开的恢复令牌可用于接管既有身份。 */
  recoveryToken?: string
  recoveryTokenExpiresAt?: number
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
        return parsed.recoveryToken &&
          parsed.recoveryTokenExpiresAt &&
          parsed.recoveryTokenExpiresAt > Date.now()
          ? {
              ...base,
              recoveryToken: parsed.recoveryToken,
              recoveryTokenExpiresAt: parsed.recoveryTokenExpiresAt,
            }
          : base
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
  const connected = ref(socket.connected) // 是否已连接
  const connectionLabel = ref<ConnectionLabel>(strings.connection.connecting) // 连接状态文案
  const latency = ref(0) // 最近一次往返延迟（毫秒）
  const clockOffset = ref(0) // 客户端与服务端时钟偏移（ms，服务端时间 - 本地时间），用于倒计时校正
  // ---- 服务端同步状态 ----
  const presence = ref<PresenceSnapshot>({ players: [], rooms: [] }) // 大厅在线玩家与房间列表
  const room = ref<RoomSnapshot>() // 当前房间快照（含对局视图）
  const vocabulary = ref<VocabularySnapshot>() // 词库快照（仅房主）
  const invites = ref<Invite[]>([]) // 收到的邀请列表
  /** 画布渲染代次：每次收到笔画追加/新命令时递增，供画布组件可靠触发增量绘制。 */
  const drawRevision = ref(0)
  // Toast 队列：timer 为自动移除定时器句柄；repeated 标记“同内容被多次触发”以做防抖变色
  const toasts = ref<
    Array<{
      id: string
      type: 'success' | 'warning' | 'error'
      text: string
      repeated?: boolean
      timer?: number
    }>
  >([]) // Toast 通知队列
  const busy = ref(false) // 注册/请求进行中的忙碌标记

  // 派生状态：便捷读取当前玩家在房间中的角色
  const me = computed(() => room.value?.members.find((member) => member.id === playerId.value))
  const isHost = computed(() => room.value?.hostId === playerId.value)
  const isDrawer = computed(() => room.value?.game?.drawerId === playerId.value)

  /** 弹出 Toast 通知，指定时长后自动移除；同内容未消失时防抖合并：仅延长停留并轻度变色。 */
  function notify(text: string, type: 'success' | 'warning' | 'error' = 'success'): void {
    const same = toasts.value.find((toast) => toast.text === text && toast.type === type)
    if (same) {
      // 防抖：同一通知再次触发时不清除已有条目，仅重排移除时间并标记变色（轻微提示）
      same.repeated = true
      window.clearTimeout(same.timer)
      same.timer = window.setTimeout(() => removeToast(same.id), APP_CONFIG.ui.toastDurationMs)
      return
    }
    const id = createUuid()
    const timer = window.setTimeout(() => removeToast(id), APP_CONFIG.ui.toastDurationMs)
    toasts.value.push({ id, type, text, repeated: false, timer })
  }

  /** 按 id 移除 Toast（幂等：已被定时器移除时安全忽略）。 */
  function removeToast(id: string): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  /** 手动关闭指定 Toast；竞态下若该条已超时移除则安全忽略（避免 splice(-1)）。 */
  function dismissToast(id: string): void {
    const toast = toasts.value.find((item) => item.id === id)
    if (toast) window.clearTimeout(toast.timer) // 手动关闭后取消自动移除，避免残留
    removeToast(id)
  }

  /** 所有可失败请求使用 timeout + ack，并在这里统一翻译网络失败（实现见 stores/request.ts）。 */
  const request = createRequester({ socket, notify })

  /**
   * 执行不带向上传播的请求：失败时 request 已弹出错误 Toast，这里静默吞掉，
   * 避免 Vue 事件处理器收到未捕获 rejection 而产生页面级错误（pageerror）。
   */
  async function guarded<T>(promise: Promise<T>): Promise<T | undefined> {
    try {
      return await promise
    } catch {
      return undefined
    }
  }

  async function register(): Promise<void> {
    if (!socket.connected) {
      notify(strings.store.notConnected, 'warning')
      return
    }
    busy.value = true
    try {
      const result = await guarded<{
        player: { id: string; nickname: string; avatarId: Profile['avatarId'] }
        recoveryToken: string
        restored: boolean
      }>(
        request(EVENTS.sessionRegister, {
          protocolVersion: APP_CONFIG.app.protocolVersion,
          profile: { nickname: profile.value.nickname, avatarId: profile.value.avatarId },
          preferences: {
            discoverable: settings.value.discoverable,
            acceptsInvites: settings.value.acceptsInvites,
          },
          // 只传递不会公开的恢复令牌；公开 playerId 不具备身份凭证能力。
          ...(profile.value.recoveryToken ? { recoveryToken: profile.value.recoveryToken } : {}),
        }),
      )
      // 注册失败时 request 已弹错误 Toast，直接终止本次流程。
      if (!result) return
      playerId.value = result.player.id
      profile.value = {
        ...profile.value,
        nickname: result.player.nickname,
        avatarId: result.player.avatarId,
        recoveryToken: result.recoveryToken,
        recoveryTokenExpiresAt: Date.now() + PUBLIC_CONFIG.network.recoveryTokenLifetimeMs,
      }
      saveProfile()
      page.value = 'lobby'
      notify(result.restored ? strings.store.restored : strings.store.enteredLobby)
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
    page.value = 'profile'
    notify(strings.store.profileCleared, 'warning')
  }

  /** 向服务端提交资料修改（不影响当前房间状态）。 */
  async function updateProfile(): Promise<void> {
    const result = await guarded<Profile>(
      request(EVENTS.sessionUpdateProfile, {
        profile: { nickname: profile.value.nickname, avatarId: profile.value.avatarId },
      }),
    )
    if (!result) return // 失败已提示，不覆盖本地资料
    profile.value = { ...profile.value, ...result }
    saveProfile()
    notify(strings.store.profileUpdated)
  }

  /** 创建公开或私密房间；失败时保持弹窗关闭前的当前页面状态。 */
  async function createRoom(input: {
    name: string
    visibility: RoomVisibility
    settings: RoomSettings
  }): Promise<void> {
    const snapshot = await guarded<RoomSnapshot>(request(EVENTS.roomCreate, input))
    if (snapshot) room.value = snapshot
  }
  /** 加入大厅中的公开房间。 */
  async function joinRoom(roomId: string): Promise<void> {
    const snapshot = await guarded<RoomSnapshot>(request(EVENTS.roomJoin, { roomId }))
    if (snapshot) room.value = snapshot
  }

  /** 使用服务端生成的短码加入私密房；失败时保留弹窗和输入供重试。 */
  async function joinPrivateRoom(code: string): Promise<void> {
    const snapshot = await guarded<RoomSnapshot>(request(EVENTS.roomJoinPrivate, { code }))
    if (snapshot) room.value = snapshot
  }

  /** 退出当前房间并清理本地对局/词库状态。 */
  async function leaveRoom(): Promise<void> {
    // roomLeave 成功时服务端返回空 data，改用哨兵区分“请求失败”与“成功但无数据”。
    let succeeded = false
    await guarded(
      request<undefined>(EVENTS.roomLeave).then((data) => {
        succeeded = true
        return data
      }),
    )
    if (!succeeded) return
    room.value = undefined
    vocabulary.value = undefined
    notify(strings.store.roomLeft)
  }

  /** 切换自己在本局的准备状态。 */
  async function setReady(ready: boolean): Promise<void> {
    await guarded(request(EVENTS.roomSetReady, { ready }))
  }

  /** 房主更新房间规则（带乐观并发版本号）。 */
  async function updateRoomSettings(patch: Partial<RoomSettings>): Promise<void> {
    if (!room.value) return
    await guarded(
      request(EVENTS.roomUpdateSettings, { patch, expectedVersion: room.value.stateVersion }),
    )
  }

  /** 房主拉取词库快照。 */
  async function loadVocabulary(): Promise<void> {
    const snapshot = await guarded<VocabularySnapshot>(request(EVENTS.roomGetVocabulary))
    if (snapshot) vocabulary.value = snapshot
  }

  /** 房主保存本局词库选择（带版本号，失败会提示重新确认）。 */
  async function saveVocabulary(ids: string[]): Promise<void> {
    if (!room.value) return
    const snapshot = await guarded<VocabularySnapshot>(
      request(EVENTS.roomUpdateVocabulary, {
        ids,
        expectedVersion: room.value.stateVersion,
      }),
    )
    if (!snapshot) return
    vocabulary.value = snapshot
    notify(strings.store.vocabularyUpdated)
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

  /** 提交猜词文本（服务端判定正确/接近）。 */
  async function submitGuess(text: string): Promise<void> {
    if (!room.value?.game) return
    await guarded(request(EVENTS.guessSubmit, { roundId: room.value.game.roundId, text }))
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
  async function returnWaiting(): Promise<void> {
    await guarded(request(EVENTS.gameReturnWaiting))
  }
  async function kick(targetId: string): Promise<void> {
    await guarded(request(EVENTS.roomKick, { targetId }))
  }
  async function transferHost(targetId: string): Promise<void> {
    await guarded(request(EVENTS.roomTransferHost, { targetId }))
  }

  /** 向指定在线玩家发送定向房间邀请。 */
  async function invite(targetId: string): Promise<void> {
    let succeeded = false
    await guarded(
      request<Invite>(EVENTS.inviteSend, { targetId }).then((data) => {
        succeeded = true
        return data
      }),
    )
    if (!succeeded) return
    notify(strings.store.inviteSent)
  }

  /** 接受/拒绝邀请；接受成功后切换到受邀房间。 */
  async function respondInvite(inviteId: string, accept: boolean): Promise<void> {
    // 拒绝时服务端返回 undefined 仍属成功，用哨兵区分失败与成功但无数据。
    let succeeded = false
    const joined = await guarded<RoomSnapshot | undefined>(
      request<RoomSnapshot | undefined>(EVENTS.inviteRespond, {
        inviteId,
        accept,
      }).then((data) => {
        succeeded = true
        return data
      }),
    )
    if (!succeeded) return
    invites.value = invites.value.filter((invite) => invite.id !== inviteId)
    if (joined) room.value = joined
  }

  /**
   * 注册全部服务端推送事件的监听器（全局唯一的连接生命周期）。
   * 注意：绘图增量事件在这里按回合 ID 与序号直接合并进本地历史，无需等待下一次快照。
   */
  /** 注册服务端推送事件：把 socket.ts 的回调桥接回本地 refs（绘图增量合并见 socket.ts 约定）。 */
  attachSocketListeners({
    onConnect: () => {
      connected.value = true
      connectionLabel.value = strings.connection.connected
      // 已有本机身份（服务端签发的 playerId 或未过期的恢复令牌）→ 自动登录进大厅
      if (playerId.value || profile.value.recoveryToken) void register()
    },
    onDisconnect: (reason) => {
      connected.value = false
      connectionLabel.value =
        reason === 'io server disconnect'
          ? strings.connection.unavailable
          : strings.connection.reconnecting
    },
    onReconnectAttempt: () => (connectionLabel.value = strings.connection.reconnecting),
    onIoError: () => (connectionLabel.value = strings.connection.unstable),
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
          // 中途丢过笔画增量：请求全量画布历史（stateResync 服务端会强制全量下发）
          void guarded<RoomSnapshot | undefined>(request(EVENTS.stateResync, {})).then((full) => {
            if (full?.game) room.value = full
          })
          return // 修正结果以全量快照为准，不再沿用残缺本地历史
        }
        snapshot = {
          ...snapshot,
          game: { ...snapshot.game, strokes: localStrokes, strokesOmitted: false },
        }
      }
      room.value = snapshot
    },
    onInviteReceived: (invite) => {
      invites.value.push(invite)
      notify(strings.app.inviteReceived(invite.from.nickname, invite.roomName), 'warning')
    },
    onInviteResolved: (id) => (invites.value = invites.value.filter((invite) => invite.id !== id)),
    onRoomClosed: (reason) => {
      room.value = undefined
      notify(reason, 'warning')
    },
    onSystemNotice: (text) => notify(text, 'warning'),
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
      // 同 ID 追加不改变命令数组长度/撤销状态，普通 watch 不会触发；
      // 用显式绘制代次让画布组件可靠增量绘制长笔画的后续批次。
      drawRevision.value += 1
    },
    // 填充增量：按回合 ID 与命令 ID 去重后追加；同样执行历史上限截断
    onDrawFillCommit: (roundId, fill) => {
      const game = room.value?.game
      if (!game || game.roundId !== roundId || game.strokes.some((item) => item.id === fill.id))
        return
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
    drawRevision,
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
    returnWaiting,
    kick,
    transferHost,
    invite,
    respondInvite,
  }
})
