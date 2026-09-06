import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../config/index.ts'
import { EVENTS } from '@draw-guess/shared'
import type { RoomSettings } from '@draw-guess/shared'
import { GameService } from '../../apps/server/src/game-service.ts'
import { SILENT_LOGGER } from '../../apps/server/src/errors.ts'
import { createFakeClock, type FakeClock } from './helpers/fake-clock.ts'
import { createMemoryRepositories } from './helpers/in-memory-repositories.ts'
import { createMemoryVocabularyRegistry } from './helpers/mini-vocabulary.ts'

// 不直接 import socket.io（test/ 目录在 pnpm 严格 node_modules 下解析不到它），
// 而是从 GameService 的形参类型派生 io/Socket 的精确类型，保持 stub 的类型一致性。
type GameServiceIo = ConstructorParameters<typeof GameService>[0]
type RegisterSocket = Parameters<GameService['register']>[0]

/** 最小合法房间设置：全部值落在 config/game.ts 与 config/room.ts 的合法区间内。 */
const settings: RoomSettings = {
  maxPlayers: 4,
  roundsPerPlayer: 2,
  drawSeconds: 90,
  chooseSeconds: 15,
  optionCount: 3,
  showWordLength: true,
  progressiveHints: true,
  structuredHintsEnabled: true,
  hintStartRatio: 0.35,
  guessBaseScore: 300,
  scoreMode: 'standard',
  allowPlayerInvite: true,
  allowPause: true,
  allowWordReroll: true,
  joinPolicy: 'forbid',
}

/** 录制型 socket 桩：记录发给该成员的最新房间快照，供测试断言当前对局状态。 */
interface RecordingSocket {
  id: string
  data: { playerId?: string }
  lastSnapshot: unknown
  join: () => void
  emit: (event: string, payload: unknown) => void
}

function createSocket(id: string): RecordingSocket {
  // lastSnapshot 通过闭包捕获，避免箭头/方法内 this 指代错误
  let lastSnapshot: unknown
  return {
    id,
    data: {},
    get lastSnapshot() {
      return lastSnapshot
    },
    join: () => undefined,
    emit: (event, payload) => {
      // 只记录 roomSnapshot 一类载荷，其它事件忽略；若记录全部事件会污染断言
      if (event === EVENTS.roomSnapshot) lastSnapshot = payload
    },
  }
}

/** 用内存仓储 + 假时钟构建 GameService（io 用轻量桩，不开 Socket.IO、不碰 SQLite）。 */
function buildService(clock: FakeClock): { service: GameService; clock: FakeClock } {
  const io = {
    to: () => ({ emit: () => undefined }),
    in: () => ({ emit: () => undefined }),
    emit: () => undefined,
  } as unknown as GameServiceIo
  const service = new GameService(
    io,
    createMemoryVocabularyRegistry(),
    createMemoryRepositories(),
    SILENT_LOGGER,
    clock,
  )
  return { service, clock }
}

/** 注册一名玩家，返回其 playerId 与录制 socket。 */
function registerPlayer(
  service: GameService,
  id: string,
  nickname: string,
): { playerId: string; socket: RecordingSocket } {
  const socket = createSocket(id)
  const result = service.register(socket as unknown as RegisterSocket, {
    protocolVersion: APP_CONFIG.app.protocolVersion,
    profile: { nickname, avatarId: '01' },
    preferences: { discoverable: true, acceptsInvites: true },
  })
  return { playerId: result.player.id, socket }
}

/**
 * 搭建一局 2 人对局并推进到「作画阶段」：
 * 注册两名玩家 → 建房 → 加入 → 客就绪 → 开局（假调度器推进 3s）→ 选词。
 * 返回 { service, clock, drawerId, roundId, answer, drawerSocket }。
 */
function setupDrawingRound(
  service: GameService,
  clock: FakeClock,
  host: { playerId: string; socket: RecordingSocket },
  guest: { playerId: string; socket: RecordingSocket },
) {
  // 建房（房主）→ 公开房
  const room = service.createRoom(host.playerId, { name: '测试房', visibility: 'public', settings })
  // 客人加入
  service.joinRoom(guest.playerId, room.id)
  // 客人就绪；返回快照中的 stateVersion 作为随后 startGame 的乐观并发版本号
  const guestReady = service.setReady(guest.playerId, true)
  // 开局（房主发起）。开局会进入 3 秒开始倒计时，随后单独时序切换到选词阶段。
  service.startGame(host.playerId, guestReady.stateVersion)
  clock.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
  return { roomId: room.id }
}

/** 读取录制 socket 的最新快照里的游戏视图（用于拿 roundId/drawerId/所选词/阶段）。 */
function gameView(socket: RecordingSocket): {
  phase: string
  roundId: string
  drawerId: string
  wordOptions?: Array<{ id: string; text: string }>
  answer?: { text: string }
  phaseEndsAt: number
} {
  // 阶段在 RoomSnapshot 根对象（phase）；回合内视图字段在 game（GameView）
  const envelope = socket.lastSnapshot as { data?: unknown }
  const snapshot = envelope.data as {
    phase: string
    game?: {
      roundId: string
      drawerId: string
      phaseEndsAt: number
      wordOptions?: Array<{ id: string; text: string }>
      answer?: { text: string }
    }
  }
  const game = snapshot.game
  if (!game) throw new Error('尚未收到对局快照')
  return { phase: snapshot.phase, ...game }
}

describe('假时钟下的截止时间校验（submitGuess）', () => {
  it('截止前可提交；截止后按服务端权威时间拒绝（PHASE_EXPIRED）', () => {
    const { service, clock } = buildService(createFakeClock())
    const host = registerPlayer(service, 's-host', '房主')
    const guest = registerPlayer(service, 's-guest', '客人')
    setupDrawingRound(service, clock, host, guest)

    // 开局后房主收到 choosing 快照；宣读 drawerId，找画家再取其 wordOptions
    const hostView = gameView(host.socket)
    const drawerId = hostView.drawerId
    const drawerSocket = drawerId === host.playerId ? host.socket : guest.socket
    const drawerView = gameView(drawerSocket)
    const wordOptions = drawerView.wordOptions
    if (!wordOptions?.length) throw new Error('选词阶段未提供候选词')

    // 画家选择第一个候选词 → 进入作画阶段
    service.chooseWord(drawerId, drawerView.roundId, wordOptions[0]!.id)
    const drawingView = gameView(host.socket)
    if (drawingView.phase !== 'drawing') throw new Error(`期望作画阶段，实际 ${drawingView.phase}`)
    const nonDrawer = drawerId === host.playerId ? guest : host

    // A) 截止前：非画家提交任意猜词，作为普通猜词进入聊天流，返回 correct=false（不抛错）
    expect(service.submitGuess(nonDrawer.playerId, drawingView.roundId, '不存在的词')).toEqual({
      correct: false,
    })

    // B) 截止后：把服务端假时钟推进到作画截止之后，再提交应被权威拒绝（PHASE_EXPIRED）
    clock.jump(settings.drawSeconds * 1_000 + 1)
    expect(() => service.submitGuess(nonDrawer.playerId, drawingView.roundId, '任意')).toThrowError(
      /当前操作已超时|阶段已结束/,
    )
  })

  it('在认过的词语内选词可用（回归：画家选择合法词不报 INVALID_WORD_ID）', () => {
    const { service, clock } = buildService(createFakeClock())
    const host = registerPlayer(service, 's-host2', '房主2')
    const guest = registerPlayer(service, 's-guest2', '客人2')
    setupDrawingRound(service, clock, host, guest)
    const hostView = gameView(host.socket)
    const drawerId = hostView.drawerId
    const drawerSocket = drawerId === host.playerId ? host.socket : guest.socket
    const drawerView = gameView(drawerSocket)
    const wordOptions = drawerView.wordOptions
    if (!wordOptions?.length) throw new Error('选词阶段未提供候选词')

    // 选择第一个候选词不抛错（INVALID_WORD_ID）即视为通过
    expect(() => service.chooseWord(drawerId, drawerView.roundId, wordOptions[0]!.id)).not.toThrow()
  })
})
