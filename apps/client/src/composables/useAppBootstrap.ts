import { onBeforeUnmount } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import {
  EVENTS,
  ROOM_CLOSE_CODE,
  type MemberConnectionChange,
  type ServerPushEventName,
} from '@draw-guess/shared'
import type { InvalidPushReason } from '@/stores/push-protocol'
import { useGameTransport, type GameTransport } from '@/application/game-transport'
import type { PushHandlerMap } from '@/stores/socket'
import { useGameStore } from '@/stores/game'
import { useLobbyStore } from '@/stores/lobby'
import { useProfileStore } from '@/stores/profile'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { useResyncStore } from '@/stores/resync'
import { useRoomSync } from './useRoomSync'

/** 应用级 Socket、恢复、ping 与 HMR 生命周期；start/stop 均幂等。 */
export function useAppBootstrap(transport: GameTransport = useGameTransport()) {
  const { notify } = transport
  const gameStore = useGameStore()
  const profileStore = useProfileStore()
  const settingsStore = useSettingsStore()
  const sessionStore = useSessionStore()
  const lobbyStore = useLobbyStore()
  const resyncStore = useResyncStore()
  const roomSync = useRoomSync()
  let detachListeners: (() => void) | undefined
  let pingTimer: number | undefined

  // 注册与「恢复后落位房间/清空词库」的跨领域编排统一委托 Facade，
  // 组合式函数不再复制第二份恢复回调（见 stores/game.ts 的 register）。
  async function register(automatic = false): Promise<void> {
    await gameStore.register(automatic)
  }

  function onMemberConnectionChanged(change: MemberConnectionChange): void {
    // payload 已整体经 MemberConnectionChangeSchema（playerId 为 z.string().uuid()）解码，
    // 空串不可达；只需过滤本人——自己的连/断由页面状态体现，不做成员播报。
    if (change.playerId === sessionStore.playerId) return
    if (change.connection === 'left') {
      notify(strings.ui.store.memberLeftGame(change.nickname), 'warning')
      return
    }
    notify(
      change.connection === 'reconnecting'
        ? strings.ui.store.memberDisconnected(change.nickname)
        : strings.ui.store.memberReconnected(change.nickname),
      change.connection === 'reconnecting' ? 'warning' : 'success',
    )
  }

  function handleConnect(): void {
    sessionStore.connected = true
    sessionStore.connectionLabel = strings.ui.connection.connected
    if (sessionStore.playerId || profileStore.profile.recoveryToken) {
      sessionStore.sessionState = 'restoring'
      void register(true)
    }
  }

  /**
   * 推送单注册表（ADR-0020）：协议每个事件在此登记「处理回调 + 非法载荷恢复策略」。
   * `PushHandlerMap` 按 SERVER_PUSH_SCHEMAS 逐事件穷尽——新增推送事件漏登记（任一项）
   * 直接编译失败；attachSocketListeners 的注册/解绑清单由事件名派生，本表即唯一登记处。
   */
  const push: PushHandlerMap = {
    [EVENTS.presenceSnapshot]: {
      on: (snapshot) => (lobbyStore.presence = snapshot),
      // 大厅域推送：非法载荷时通用 resync 让服务端计数，再走各自的权威列表入口。
      recovery: 'presence-refresh',
    },
    [EVENTS.roomListChanged]: {
      on: (rooms) => (lobbyStore.presence.rooms = rooms),
      recovery: 'room-list-refresh',
    },
    [EVENTS.roomSnapshot]: { on: roomSync.onRoomSnapshot, recovery: 'room-snapshot' },
    [EVENTS.roomMemberConnectionChanged]: {
      on: onMemberConnectionChanged,
      recovery: 'room-snapshot',
    },
    [EVENTS.inviteReceived]: {
      on: (invite) => {
        lobbyStore.invites.push(invite)
        notify(strings.ui.app.inviteReceived(invite.from.nickname, invite.roomName), 'warning')
      },
      recovery: 'generic-resync',
    },
    [EVENTS.inviteResolved]: {
      on: ({ id }) => {
        lobbyStore.invites = lobbyStore.invites.filter((invite) => invite.id !== id)
      },
      recovery: 'generic-resync',
    },
    [EVENTS.roomClosed]: {
      on: ({ reason, code }) => {
        resyncStore.invalidateSession()
        // 业务语义只看稳定关闭码；reason 仅作为展示文案，允许随时改文案或做本地化。
        if (code === ROOM_CLOSE_CODE.kicked) sessionStore.kickedNotice = true
        notify(reason, 'warning')
      },
      recovery: 'room-snapshot',
    },
    [EVENTS.systemNotice]: {
      on: ({ text }) => notify(text, 'warning'),
      recovery: 'generic-resync',
    },
    [EVENTS.systemError]: { on: ({ text }) => notify(text, 'error'), recovery: 'generic-resync' },
    [EVENTS.drawStrokeBatch]: {
      // 增量事件按回合 ID 与序号直接合并进本地历史，无需等待下一次快照；
      // data 结构上即 DrawingIncrementMeta 的超集，解构留给消费端。
      on: (data) => roomSync.onStroke(data, data.stroke),
      recovery: 'room-snapshot',
    },
    [EVENTS.drawFillCommit]: {
      on: (data) => roomSync.onFill(data, data.fill),
      recovery: 'room-snapshot',
    },
  }

  /** 非房间推送的通用自愈请求：用无内容的枚举原因让服务端计数，绝不回传非法载荷。 */
  function requestGenericResync(): void {
    void transport.request(
      EVENTS.stateResync,
      { reason: 'invalid_push' },
      { retry: false, notify: 'silent' },
    )
  }

  function handleInvalidPush(event: ServerPushEventName, reason: InvalidPushReason): void {
    if (reason === 'protocol_mismatch') {
      sessionStore.markProtocolMismatch()
      return
    }
    // 恢复通道查注册表：事件 ↔ 策略的配对在登记处声明，这里只看策略执行（不再有事件名单）。
    switch (push[event].recovery) {
      case 'room-snapshot':
        void resyncStore.requestFullSnapshot('invalid_push')
        return
      case 'presence-refresh':
        requestGenericResync()
        void lobbyStore.refreshPresence()
        return
      case 'room-list-refresh':
        requestGenericResync()
        void lobbyStore.refreshRooms()
        return
      case 'generic-resync':
        requestGenericResync()
        return
    }
  }

  function start(): void {
    if (detachListeners) return
    detachListeners = transport.attach({
      onConnect: handleConnect,
      onDisconnect: (reason) => {
        sessionStore.connected = false
        sessionStore.clearRestoreRetry()
        if (
          reason === 'io server disconnect' &&
          (sessionStore.playerId || profileStore.profile.recoveryToken)
        ) {
          sessionStore.sessionState = 'idle'
          resyncStore.invalidateSession()
          sessionStore.page = 'profile'
          sessionStore.connectionLabel = strings.ui.connection.disconnected
          notify(strings.ui.store.sessionTakenOver, 'warning')
          return
        }
        if (sessionStore.playerId || profileStore.profile.recoveryToken)
          sessionStore.sessionState = 'disconnected'
        sessionStore.connectionLabel =
          reason === 'io server disconnect'
            ? strings.ui.connection.unavailable
            : strings.ui.connection.reconnecting
      },
      onReconnectAttempt: () => {
        sessionStore.connectionLabel = strings.ui.connection.reconnecting
        if (sessionStore.playerId || profileStore.profile.recoveryToken)
          sessionStore.sessionState = 'disconnected'
      },
      onIoError: () => {
        sessionStore.connectionLabel = strings.ui.connection.unstable
        if (
          !transport.socket.connected &&
          (sessionStore.playerId || profileStore.profile.recoveryToken)
        )
          sessionStore.sessionState = 'disconnected'
      },
      onInvalidPush: handleInvalidPush,
      push,
    })
    // 所有具名监听器注册完成后才允许连接，快速 connect/push 不会越过初始化窗口。
    if (transport.socket.connected) handleConnect()
    else transport.connect()
    // 连接建立即落一次本地设置：loadSettings 校验后的规范化值写回 localStorage，
    // 并同步动效开关的 DOM 类（motion-disabled），保证首屏动画偏好生效。
    // 传入 playerId 是为覆盖「身份已建立后再次 start」的补推路径（saveSettings 内部
    // 仅在有身份时才推送偏好）；首连场景此处 playerId 恒为空串，偏好随 sessionRegister
    // 载荷一并送达（见 stores/session.ts 的 preferences），不依赖这里补推。
    settingsStore.saveSettings(sessionStore.playerId)
    pingTimer = window.setInterval(
      () => void sessionStore.measureLatency(),
      APP_CONFIG.network.pingIntervalMs,
    )
  }

  function stop(): void {
    if (pingTimer !== undefined) window.clearInterval(pingTimer)
    pingTimer = undefined
    sessionStore.clearRestoreRetry()
    detachListeners?.()
    detachListeners = undefined
    transport.disconnect()
    sessionStore.connected = false
  }

  onBeforeUnmount(stop)
  return { start, stop }
}
