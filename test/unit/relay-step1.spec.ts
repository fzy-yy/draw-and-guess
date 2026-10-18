/**
 * 接龙步 1 作画与进入步 2（S2 / S30 / S35 / S40 / S53 / S63 / S65 / S79）。
 *
 * 断言口径（只用外部可观察行为）：
 * - 作画归属：本人的命令只进自己那条链的第一幅画布，其它链的画布不受影响；
 * - 题面：步 1 的题面就是自己选的词，且只有自己看得到；快照绝不含他人内容与未揭晓答案；
 * - 提交：全员提交（或倒计时到）即结算步 1 并进入步 2 —— 新步 id、新阶段时间、关键节点通知；
 * - 步 2 只下发上家的画作（只读）与上家 chip，既不下发题面也不下发自己的画布，
 *   更不下发未揭晓的答案与其长度（连占位下划线都不生成）；
 * - 提交类拒绝：旧步 id / 重复提交 / 超时分别以既有错误码拒绝；
 * - 聊天独立：`chat:say` 只服务接龙房，作答永不进聊天流（经典房与等待中的接龙房按 NO_GAME 拒绝）。
 */
import { describe, expect, it } from 'vitest'
import { ERROR_CODES, RELAY_STEP_COUNT, type Stroke } from '@draw-guess/shared'
import { createGameHarness, testRoomSettings } from './helpers/game-harness.ts'
import {
  errorCodeOf,
  startRelayGame,
  type RelayGameScenario,
} from './helpers/relay-game-fixture.ts'

/** 单点笔画：序号与 id 由调用方给定，便于断言「哪条命令落在哪幅画布」。 */
function dotStroke(sequence: number, id: string): Stroke {
  return {
    kind: 'stroke',
    id,
    tool: 'pen',
    color: '#1F2937',
    width: 5,
    sequence,
    startPointIndex: 0,
    points: [{ x: 0.3, y: 0.3 }],
  }
}

/** 全员选完词并停在步 1 作画幕。 */
function atDrawingStep(): RelayGameScenario {
  const scenario = startRelayGame()
  scenario.chooseAll()
  return scenario
}

describe('接龙步 1 作画', () => {
  it('本人的命令只进自己那条链的第一幅画布，其它链不受影响', () => {
    const scenario = atDrawingStep()
    const [first, second] = scenario.players
    if (!first || !second) throw new Error('场景缺少玩家')

    scenario.harness.backend.drawing.relay.addStroke(
      first.playerId,
      scenario.stepId,
      dotStroke(0, 'first-0'),
    )
    scenario.harness.backend.drawing.relay.addStroke(
      second.playerId,
      scenario.stepId,
      dotStroke(0, 'second-0'),
    )

    const firstOwn = scenario.canvasOf(first.playerId, 1)
    const secondOwn = scenario.canvasOf(second.playerId, 1)
    expect(firstOwn.strokes.map((command) => command.id)).toEqual(['first-0'])
    expect(secondOwn.strokes.map((command) => command.id)).toEqual(['second-0'])
    // 其余链的画布（含各自的第二幅）保持空白
    expect(scenario.canvasOf(first.playerId, 3).strokes).toEqual([])
    expect(scenario.canvasOf(second.playerId, 3).strokes).toEqual([])
  })

  it('题面是自己选的词、画布是自己的：快照不下发他人题面', () => {
    const scenario = atDrawingStep()
    const viewer = scenario.players[0]
    if (!viewer) throw new Error('场景缺少玩家')
    const ownChain = scenario.chainOf(viewer.playerId, 1)
    const ownTexts = ownChain.candidates.map((word) => word.text)
    const foreignTexts = scenario.relay.chains
      .filter((chain) => chain.originPlayerId !== viewer.playerId)
      .map((chain) => chain.step1Word?.text)
      .filter((text): text is string => text !== undefined && !ownTexts.includes(text))
    expect(foreignTexts.length, '必须存在只属于他人的题面才能证明没泄漏').toBeGreaterThan(0)

    const view = scenario.snapshotOf(viewer.playerId).relay
    expect(view?.phase).toBe('relay_draw')
    expect(view?.prompt).toBe(ownChain.step1Word?.text)
    expect(view?.ownCanvas?.strokes).toEqual(ownChain.step1Canvas.strokes)
    expect(view?.previousDrawing).toBeUndefined()
    const serialized = JSON.stringify(scenario.snapshotOf(viewer.playerId))
    for (const text of foreignTexts) expect(serialized, `泄漏他人题面 ${text}`).not.toContain(text)
  })

  it('全员提交即结算步 1 并进入步 2：新步 id、新阶段时间、关键节点通知', () => {
    const scenario = atDrawingStep()
    const stepOneId = scenario.stepId
    const phaseEndsAtBefore = scenario.relay.phaseEndsAt

    scenario.submitAllDrawings()

    expect(scenario.room.phase).toBe('relay_guess')
    expect(scenario.relay.currentStep).toBe(2)
    expect(scenario.relay.currentStep).toBeLessThanOrEqual(RELAY_STEP_COUNT)
    // 换棒生成**新的**全局步 id（S53），阶段时间按猜词时长重算
    expect(scenario.relay.stepId).not.toBe(stepOneId)
    expect(scenario.relay.phaseEndsAt).not.toBe(phaseEndsAtBefore)
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(
      scenario.room.settings.relayGuessSeconds * 1_000,
    )
    // 新棒的提交集清场：stepSubmissions 只记「本步」
    expect([...scenario.relay.stepSubmissions]).toEqual([])
    // 关键节点通知只在换棒时播一条「第 2 棒开始」（S65）
    expect(scenario.notices().filter((text) => text === '第 2 棒开始')).toHaveLength(1)
  })

  it('提交：重复提交与旧步 id 被拒，超时后提交被拒', () => {
    const scenario = atDrawingStep()
    const player = scenario.players[0]
    if (!player) throw new Error('场景缺少玩家')
    // 步 id 是活值（换棒会变），断言「旧包」必须先把它固定下来
    const stepOneId = scenario.stepId

    scenario.harness.backend.relay.submitDrawing(player.playerId, stepOneId)
    expect(
      errorCodeOf(() => scenario.harness.backend.relay.submitDrawing(player.playerId, stepOneId)),
    ).toBe(ERROR_CODES.ALREADY_SUBMITTED)
    expect(
      errorCodeOf(() =>
        scenario.harness.backend.relay.submitDrawing(
          player.playerId,
          '00000000-0000-4000-8000-0000000000d1',
        ),
      ),
    ).toBe(ERROR_CODES.STALE_DRAW_EVENT)

    // 作画倒计时结束 → 结算步 1（未提交的人由代交兜底，工单 06 细化）：此后提交本步一律过期
    scenario.harness.runtime.advance(scenario.room.settings.relayDrawSeconds * 1_000)
    expect(scenario.room.phase).toBe('relay_guess')
    expect(scenario.relay.stepId).not.toBe(stepOneId)
    expect(
      errorCodeOf(() => scenario.harness.backend.relay.submitDrawing(player.playerId, stepOneId)),
    ).toBe(ERROR_CODES.STALE_DRAW_EVENT)
  })

  it('作画超时（无人提交）同样进入步 2，不留下卡死的步 1', () => {
    const scenario = atDrawingStep()

    scenario.harness.runtime.advance(scenario.room.settings.relayDrawSeconds * 1_000)

    expect(scenario.room.phase).toBe('relay_guess')
    expect(scenario.relay.currentStep).toBe(2)
  })

  it('步 2 只下发上家的画作与上家 chip：无题面、无自己的画布、无未揭晓答案与长度', () => {
    const scenario = atDrawingStep()
    const viewer = scenario.players[0]
    if (!viewer) throw new Error('场景缺少玩家')
    // 步 2 观看的链 = 自己那条链向前回退 1 条（S9）；上家就是这条链的发起人
    const previousChain = scenario.chainOf(viewer.playerId, 2)
    const previousPlayer = scenario.players.find(
      (player) => player.playerId === previousChain.originPlayerId,
    )
    if (!previousPlayer) throw new Error('场景缺少上家')
    // 上家先画一笔：步 2 必须能看到这幅成品
    scenario.harness.backend.drawing.relay.addStroke(
      previousPlayer.playerId,
      scenario.stepId,
      dotStroke(0, 'previous-0'),
    )
    scenario.submitAllDrawings()

    const view = scenario.snapshotOf(viewer.playerId).relay
    expect(view?.phase).toBe('relay_guess')
    expect(view?.currentStep).toBe(2)
    expect(view?.previousDrawing?.strokes.map((command) => command.id)).toEqual(['previous-0'])
    expect(view?.previousArtist?.id).toBe(previousPlayer.playerId)
    expect(view?.previousArtist?.nickname).toBe(
      scenario.harness.backend.requirePlayer(previousPlayer.playerId).profile.nickname,
    )
    expect(view?.prompt).toBeUndefined()
    expect(view?.ownCanvas).toBeUndefined()
    expect(view?.wordOptions).toBeUndefined()

    // 未揭晓的答案（我这条链步 1 的词）既不给正文，也不给长度：连按长度生成的占位都不存在
    const answer = previousChain.step1Word
    if (!answer) throw new Error('上家链缺少题面')
    const serialized = JSON.stringify(scenario.snapshotOf(viewer.playerId))
    expect(serialized).not.toContain(answer.text)
    expect(serialized).not.toContain('＿')
    expect(serialized).not.toContain('＿'.repeat(Array.from(answer.text).length))
  })

  it('聊天与作答分离：chat:say 进房间聊天流，作答内容永不进聊天流', () => {
    const scenario = atDrawingStep()
    const [first, second] = scenario.players
    if (!first || !second) throw new Error('场景缺少玩家')

    scenario.harness.backend.relay.chat(first.playerId, '大家好呀')
    scenario.harness.backend.relay.submitDrawing(first.playerId, scenario.stepId)

    const messages = scenario.snapshotOf(second.playerId).relay?.messages ?? []
    // 房间里只有一条玩家发言（提交作画不产生任何聊天消息，S20 / S79）
    const chatMessages = messages.filter((message) => message.type !== 'system')
    expect(chatMessages).toHaveLength(1)
    expect(chatMessages[0]).toMatchObject({ text: '大家好呀', playerId: first.playerId })
  })

  it('纯空白聊天被拒（INVALID_MESSAGE）：不广播空气泡，正常聊天照旧（S79）', () => {
    const scenario = atDrawingStep()
    const [first, second] = scenario.players
    if (!first || !second) throw new Error('场景缺少玩家')

    // 空串 / 空格 / 制表符：trim 后为空，与经典猜词同口径拒绝
    for (const blank of ['', '   ', '\t']) {
      expect(
        errorCodeOf(() => scenario.harness.backend.relay.chat(first.playerId, blank)),
        JSON.stringify(blank),
      ).toBe(ERROR_CODES.INVALID_MESSAGE)
    }
    // 拒绝不落流：聊天流里没有任何玩家发言
    const chatOf = (viewerId: string) =>
      (scenario.snapshotOf(viewerId).relay?.messages ?? []).filter(
        (message) => message.type !== 'system',
      )
    expect(chatOf(second.playerId)).toHaveLength(0)

    // 正常聊天照旧：前后空白被裁掉后入流
    scenario.harness.backend.relay.chat(first.playerId, ' 大家好呀 ')
    expect(chatOf(second.playerId)).toMatchObject([{ text: '大家好呀', playerId: first.playerId }])
  })

  it('经典房与等待中的接龙房都不接受 chat:say（保持经典「猜词未命中即聊天」现状，S85）', () => {
    const classic = createGameHarness()
    const classicHost = classic.register('经典房主')
    classic.backend.room.createRoom(classicHost.playerId, {
      name: '经典房',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    expect(errorCodeOf(() => classic.backend.relay.chat(classicHost.playerId, '喂'))).toBe(
      ERROR_CODES.NO_GAME,
    )

    // 接龙房在等待阶段（还没开局）同样没有聊天流
    const waiting = createGameHarness()
    const waitingHost = waiting.register('接龙房主')
    waiting.backend.room.createRoom(waitingHost.playerId, {
      name: '接龙等待房',
      visibility: 'public',
      gameMode: 'relay',
      settings: testRoomSettings(),
    })
    expect(errorCodeOf(() => waiting.backend.relay.chat(waitingHost.playerId, '喂'))).toBe(
      ERROR_CODES.NO_GAME,
    )
  })

  it('开局倒计时期间成员离房会作废本局接龙局（等待中的房间不留残局）', () => {
    const harness = createGameHarness()
    const host = harness.register('接龙房主')
    const guests = [
      harness.register('接龙玩家2'),
      harness.register('接龙玩家3'),
      harness.register('接龙玩家4'),
    ]
    const created = harness.backend.room.createRoom(host.playerId, {
      name: '接龙房',
      visibility: 'public',
      gameMode: 'relay',
      settings: testRoomSettings(),
    })
    let latest = created
    for (const guest of guests) {
      harness.backend.room.joinRoom(guest.playerId, created.id)
      latest = harness.backend.room.setReady(guest.playerId, true)
    }
    harness.backend.gameplay.startGame(host.playerId, latest.stateVersion)
    const room = harness.backend.rooms.get(created.id)
    if (!room) throw new Error('接龙房未创建')
    expect(room.relay).toBeDefined()

    harness.backend.room.leaveRoom(guests[0]?.playerId ?? '')

    expect(room.phase).toBe('waiting')
    expect(room.relay).toBeUndefined()
    // 离房后房间仍可再次开局：残留的秘密不会污染下一局
    expect(room.members).toHaveLength(3)
  })
})
