/**
 * 原型 store 装配（纯 UI 演示，不连后端）。
 *
 * 三件事：
 * 1. 填充模拟对局数据（连接状态 / 身份 / 房间快照）；
 * 2. 把会走 socket 的 store 动作替换为本地模拟（撤销/重做/清空、猜词、预设短语、暂停/恢复）——
 *    这是原型代码，只在运行时覆盖 Facade 上的方法引用，不改动任何业务源码；
 * 3. 提供「猜词者 / 画家」视角切换，用于对比两种角色下的布局与工具栏状态。
 *
 * 兜底说明：传输层仍是 createGameTransport 的替身（socket 以 autoConnect:false 构造且从不 connect），
 * 即使某个动作漏了本地替换，也只会静默无响应，不会产生任何网络流量。
 */
import { ref } from 'vue'
import type { Pinia } from 'pinia'
import { EVENTS, type ChatMessage } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { MOCK_ANSWER, MOCK_IDS, createMockRoom, nextMockUuid } from './mock-game.ts'
import { prototypeDrawing } from './prototype-drawing.ts'

export type PrototypeRole = 'guesser' | 'drawer'

/** 当前演示视角（切换条驱动；画家视角带完整工具栏与明文答案）。 */
export const prototypeRole = ref<PrototypeRole>('guesser')

let store: ReturnType<typeof useGameStore> | undefined
let roomStore: ReturnType<typeof useRoomStore> | undefined
let sessionStore: ReturnType<typeof useSessionStore> | undefined

/** 切换视角：换身份并重建模拟房间（画家视角下发明文答案，与快照裁剪口径一致）。 */
export function setPrototypeRole(role: PrototypeRole): void {
  prototypeRole.value = role
  if (!roomStore || !sessionStore) return
  sessionStore.playerId = role === 'drawer' ? MOCK_IDS.drawer : MOCK_IDS.guesser
  roomStore.room = createMockRoom({ viewerIsDrawer: role === 'drawer' })
}

export function installPrototypeStore(pinia: Pinia): void {
  store = useGameStore(pinia)
  roomStore = useRoomStore(pinia)
  sessionStore = useSessionStore(pinia)
  // 模拟「已连接、低延迟」的会话状态（NetworkStatusButton 等组件据此渲染）
  sessionStore.connected = true
  sessionStore.connectionLabel = strings.connection.connected
  sessionStore.latency = 24
  setPrototypeRole('guesser')
  patchNetworkActions()
}

/** 把会走网络的 Facade 动作替换为本地模拟（原型专用）。 */
function patchNetworkActions(): void {
  const currentStore = store
  const currentRoom = roomStore
  const currentSession = sessionStore
  if (!currentStore || !currentRoom || !currentSession) return
  // 闭包捕获已确认存在的局部别名，避免后续异步回调把模块级可选引用重新放宽为 undefined。
  const roomState = currentRoom
  const sessionState = currentSession

  /** 追加一条本地消息（模拟服务端聊天广播）。 */
  function appendMessage(text: string, type: ChatMessage['type'], playerId?: string): void {
    const room = roomState.room
    if (!room?.game) return
    const message: ChatMessage = {
      id: nextMockUuid(),
      type,
      text,
      ...(playerId ? { playerId } : {}),
      createdAt: Date.now(),
    }
    room.game.messages = [...room.game.messages, message]
  }

  /** 猜中后标记「我」已猜中并加分（演示得分条与聊天输入权限的联动）。 */
  function markMeGuessed(): void {
    const room = roomState.room
    const me = sessionState.playerId
    if (!room) return
    room.members = room.members.map((member) =>
      member.id === me ? { ...member, guessed: true, score: member.score + 92 } : member,
    )
  }

  // 画板控制（撤销/重做/清空）：直接在本地历史上执行，不经过 socket。
  currentStore.drawAction = async (event) => {
    if (event === EVENTS.drawUndo) prototypeDrawing.undo()
    else if (event === EVENTS.drawRedo) prototypeDrawing.redo()
    else if (event === EVENTS.drawClear) prototypeDrawing.clear()
  }

  // 猜词：本地判定并追加消息；猜中时标记已猜中（含分数变化）。
  currentStore.submitGuess = async (text) => {
    if (text.trim() === MOCK_ANSWER) {
      appendMessage('猜中了答案！+92 分', 'correct', sessionState.playerId)
      markMeGuessed()
    } else {
      appendMessage(text, 'guess', sessionState.playerId)
    }
    return true
  }

  // 预设短语：本地追加消息。
  currentStore.sendPreset = async (text) => {
    appendMessage(text, 'preset', sessionState.playerId)
    return true
  }

  // 暂停/恢复：本地切换阶段并冻结剩余时间（与 useGameHud 的暂停口径一致：
  // 暂停时读 pausedRemainingMs，恢复时把冻结值续回 phaseEndsAt）。
  currentStore.pause = async () => {
    const room = roomState.room
    if (!room?.game || room.phase !== 'drawing') return
    room.game.pausedRemainingMs = Math.max(0, room.game.phaseEndsAt - Date.now())
    room.phase = 'paused'
  }
  currentStore.resume = async () => {
    const room = roomState.room
    if (!room?.game || room.phase !== 'paused') return
    const remaining = room.game.pausedRemainingMs ?? 0
    delete room.game.pausedRemainingMs
    room.game.phaseEndsAt = Date.now() + remaining
    room.phase = 'drawing'
  }
}
