import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { CLIENT_RESPONSE_SCHEMAS, EVENTS, type ClientRequestEvent } from '@draw-guess/shared'
import { createGameHarness, testRoomSettings } from './helpers/game-harness.ts'

/**
 * 响应契约的“真实输出”守卫。
 *
 * `CLIENT_RESPONSE_SCHEMAS` 比真实服务端输出更严会直接破坏游戏（客户端把正常响应判为协议损坏），
 * 因此这里用真实 `GameService` 走一遍注册、房间、词库与对局的返回值，逐条喂给响应边界：
 * Schema 与实际数据一旦漂移，本用例立即失败。
 */
const REQUEST_ID = '00000000-0000-4000-8000-0000000000ff'

function expectSuccessAck(event: ClientRequestEvent, data: unknown): void {
  const parsed = CLIENT_RESPONSE_SCHEMAS[event].safeParse({ ok: true, data, requestId: REQUEST_ID })
  expect(parsed.success, `${event} 的真实响应未通过响应 Schema`).toBe(true)
}

function registrationInput(nickname: string) {
  return {
    protocolVersion: APP_CONFIG.app.protocolVersion,
    profile: { nickname, avatarId: '01' as const },
    preferences: { discoverable: true, acceptsInvites: true },
  }
}

describe('真实服务端响应与 ack Schema 契约', () => {
  it('注册、资料、在线状态与身份恢复的返回值全部通过对应 Schema', () => {
    const harness = createGameHarness()
    const socket = harness.createSocket('contract-register')
    const identity = harness.service.register(socket as never, registrationInput('契约玩家'))

    // 与实际处理器一致的组装方式：注册身份 + room|null。
    expectSuccessAck(EVENTS.sessionRegister, {
      ...identity,
      room: harness.service.snapshotForPlayer(identity.player.id, true) ?? null,
    })
    expectSuccessAck(
      EVENTS.sessionUpdateProfile,
      harness.service.updateProfile(identity.player.id, { nickname: '契约改名', avatarId: '02' }),
    )
    expectSuccessAck(EVENTS.presenceGet, harness.service.presenceSnapshot())
    // 与 handlers/session.ts 的 room:list 实现保持一致：只取公开房间列表。
    expectSuccessAck(EVENTS.roomList, harness.service.publicRooms())
    expectSuccessAck(
      EVENTS.stateResync,
      harness.service.snapshotForPlayer(identity.player.id, true),
    )
    expectSuccessAck(EVENTS.networkPing, {
      clientTime: 1,
      serverTime: harness.service.clock.now(),
    })
    expectSuccessAck(EVENTS.sessionLogout, { success: true })
  })

  it('房间、词库与对局流程的返回值全部通过对应 Schema', () => {
    const harness = createGameHarness()
    const host = harness.register('契约房主')
    const guest = harness.register('契约客人')

    const created = harness.service.createRoom(host.playerId, {
      name: '契约房',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    expectSuccessAck(EVENTS.roomCreate, created)
    expectSuccessAck(EVENTS.roomJoin, harness.service.joinRoom(guest.playerId, created.id))

    const room = harness.service.rooms.get(created.id)
    if (!room) throw new Error('房间未创建')

    const settings = harness.service.updateSettings(
      host.playerId,
      { drawSeconds: 90 },
      room.stateVersion,
    )
    expectSuccessAck(EVENTS.roomUpdateSettings, settings)

    const vocabulary = harness.service.getVocabulary(host.playerId)
    expectSuccessAck(EVENTS.roomGetVocabulary, vocabulary)
    const updated = harness.service.updateVocabulary(
      host.playerId,
      vocabulary.items.map((item) => item.id),
      room.stateVersion,
    )
    expectSuccessAck(EVENTS.roomUpdateVocabulary, updated)
    const selected = harness.service.selectVocabularyPackages(
      host.playerId,
      vocabulary.packageIds,
      room.stateVersion,
    )
    expectSuccessAck(EVENTS.roomSelectVocabularyPackage, selected)
    expectSuccessAck(EVENTS.stateResync, harness.service.snapshotForPlayer(guest.playerId, true))

    // 规则修改会重置准备状态，因此准备与开局放在最后。
    const ready = harness.service.setReady(guest.playerId, true)
    expectSuccessAck(EVENTS.roomSetReady, ready)
    expectSuccessAck(EVENTS.gameStart, harness.service.startGame(host.playerId, ready.stateVersion))

    harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
    const game = harness.service.rooms.get(created.id)?.game
    if (!game?.candidates[0]) throw new Error('对局未进入选词阶段')
    harness.service.chooseWord(game.drawerId, game.roundId, game.candidates[0].id)

    const stroke = {
      kind: 'stroke' as const,
      id: 'stroke-contract-1',
      tool: 'pen' as const,
      color: '#1F2937',
      width: 5,
      points: [{ x: 0.25, y: 0.25 }],
      sequence: 0,
      startPointIndex: 0,
    }
    expectSuccessAck(
      EVENTS.drawStrokeBatch,
      harness.service.addStroke(game.drawerId, game.roundId, stroke),
    )
    expectSuccessAck(
      EVENTS.drawFillCommit,
      harness.service.addFill(game.drawerId, game.roundId, {
        kind: 'fill',
        id: 'fill-contract-1',
        point: { x: 0.5, y: 0.5 },
        color: '#EF4444',
        sequence: 1,
      }),
    )

    const guesserId = game.drawerId === host.playerId ? guest.playerId : host.playerId
    expectSuccessAck(
      EVENTS.guessSubmit,
      harness.service.submitGuess(guesserId, game.roundId, '肯定不是正确答案'),
    )
  })
})
