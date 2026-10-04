/**
 * 接龙步 2–4（猜 → 按答案画 → 猜）与掉队代交（S7 / S8 / S15 / S16 / S20 / S35 / S40 / S53 / S64 / S65）。
 *
 * 断言口径（只用外部可观察行为）：
 * - 四步顺序与每步全员各动手一次：换棒生成新步 id、提交集清场、阶段时间按本棒时长重算；
 * - 秒切：全员提交即取消剩余倒计时（步 1–4 同一口径）；作答不进聊天流（S20）；
 * - 提交与锁定：空提交 / 超长 / 重复提交 / 旧步 id / 非猜词阶段分别按既有错误码拒绝；
 * - 代交：超时与断线宽限「先到者」触发，内容按步骤类型（猜词＝「？」、作画＝已有笔画），
 *   两条路径由同一个提交集去重——代交后再提交一律 ALREADY_SUBMITTED（不可推翻）；
 * - 离开 / 退局者仍占链位、后续每步自动代交；可玩人数掉到 4 以下不中止，四步照常走完；
 * - 步 4 结算后进入复盘阶段并停止接龙对局计时（复盘游标与轮播时序归工单 07）；
 * - 隐私：步 3 快照不含上家的画，步 2/4 快照不含任何答案文本与自己的画布（S35）。
 */
import { describe, expect, it } from 'vitest'
import { ERROR_CODES, type Stroke } from '@draw-guess/shared'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import {
  errorCodeOf,
  startRelayGame,
  type RelayGameScenario,
  type RelayTestPlayer,
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

/** 全员选完词、提交完步 1 作画，停在步 2 猜词幕。 */
function atGuessStep(): RelayGameScenario {
  const scenario = startRelayGame()
  scenario.chooseAll()
  scenario.submitAllDrawings()
  return scenario
}

/** 全员走完步 1–2，停在步 3 作画幕（题面＝上家猜出的文本）。 */
function atSecondDrawingStep(): RelayGameScenario {
  const scenario = atGuessStep()
  scenario.submitAllGuesses()
  return scenario
}

/** 同上前提，但每人先在自己那条链的第一幅画上留一笔：步 3 的隐私断言才有真东西可漏。 */
function atSecondDrawingStepWithPaintedFirstHalf(): RelayGameScenario {
  const scenario = startRelayGame()
  scenario.chooseAll()
  scenario.players.forEach((player, index) => {
    scenario.harness.service.addRelayStroke(
      player.playerId,
      scenario.stepId,
      dotStroke(0, `half1-${index}`),
    )
  })
  scenario.submitAllDrawings()
  scenario.submitAllGuesses()
  return scenario
}

describe('接龙步 2 / 4 猜词', () => {
  it('每人的答案只写进本棒那条链：其余链不受影响，且作答不进聊天流', () => {
    const scenario = atGuessStep()
    const [first, second] = scenario.players
    if (!first || !second) throw new Error('场景缺少玩家')

    scenario.harness.service.submitRelayGuess(first.playerId, scenario.stepId, '一只狐狸')
    scenario.harness.service.submitRelayGuess(second.playerId, scenario.stepId, '一个西瓜')

    // 步 2 的观看链＝自己那条链向前回退 1 条（S9）：两人的答案落在各自不同的链上
    const firstChain = scenario.chainOf(first.playerId, 2)
    const secondChain = scenario.chainOf(second.playerId, 2)
    expect(firstChain).not.toBe(secondChain)
    expect(firstChain.step2Guess).toBe('一只狐狸')
    expect(secondChain.step2Guess).toBe('一个西瓜')
    // 未提交者负责的链仍无产出
    expect(scenario.relay.chains.filter((chain) => chain.step2Guess === undefined)).toHaveLength(
      scenario.players.length - 2,
    )
    // 作答是保密频道：房间聊天流里不出现任何答案文本（S20 / S79）
    const messages = scenario.snapshotOf(second.playerId).relay?.messages ?? []
    expect(messages.some((message) => message.text === '一只狐狸')).toBe(false)
    expect(messages.some((message) => message.text === '一个西瓜')).toBe(false)
  })

  it('全员提交即秒切步 3：阶段与步号、新步 id、提交集清场、阶段时间按作画时长重算、通知一次', () => {
    const scenario = atGuessStep()
    const stepTwoId = scenario.stepId
    const submitted = scenario.submitAllGuesses()

    expect(scenario.room.phase).toBe('relay_draw')
    expect(scenario.relay.currentStep).toBe(3)
    // 换棒生成新的全局步 id（S53），阶段时间按作画时长重算
    expect(scenario.relay.stepId).not.toBe(stepTwoId)
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(
      scenario.room.settings.relayDrawSeconds * 1_000,
    )
    expect([...scenario.relay.stepSubmissions]).toEqual([])
    expect(
      scenario.notices().filter((text) => text === serverStrings.notices.relayStepStarted(3)),
    ).toHaveLength(1)
    // 每人的答案都落在自己负责的那条链上（每步全员各动手一次）
    for (const player of scenario.players) {
      expect(scenario.guessOf(player.playerId, 2)).toBe(submitted.get(player.playerId))
    }
  })

  it('已提交在快照里派生：本人 true、其余人 false（成员状态零新增字段，S64）', () => {
    const scenario = atGuessStep()
    const [first, second] = scenario.players
    if (!first || !second) throw new Error('场景缺少玩家')

    scenario.harness.service.submitRelayGuess(first.playerId, scenario.stepId, '先交的人')

    expect(scenario.snapshotOf(first.playerId).relay?.submitted).toBe(true)
    expect(scenario.snapshotOf(second.playerId).relay?.submitted).toBe(false)
  })

  it('空提交（含全空白）与超长文本被拒，且不锁定本棒', () => {
    const scenario = atGuessStep()
    const player = scenario.players[0]
    if (!player) throw new Error('场景缺少玩家')

    expect(
      errorCodeOf(() =>
        scenario.harness.service.submitRelayGuess(player.playerId, scenario.stepId, ''),
      ),
    ).toBe(ERROR_CODES.INVALID_MESSAGE)
    expect(
      errorCodeOf(() =>
        scenario.harness.service.submitRelayGuess(player.playerId, scenario.stepId, '   '),
      ),
    ).toBe(ERROR_CODES.INVALID_MESSAGE)
    const tooLong = '字'.repeat(APP_CONFIG.player.chatMaxLength + 1)
    expect(
      errorCodeOf(() =>
        scenario.harness.service.submitRelayGuess(player.playerId, scenario.stepId, tooLong),
      ),
    ).toBe(ERROR_CODES.INVALID_MESSAGE)
    // 被拒的请求不改任何权威状态：本棒仍未提交、链上仍无产出
    expect(scenario.relay.stepSubmissions.has(player.playerId)).toBe(false)
    expect(scenario.guessOf(player.playerId, 2)).toBeUndefined()

    // 随后的合法提交照常生效（输入上限与聊天同口径，S15）
    scenario.harness.service.submitRelayGuess(player.playerId, scenario.stepId, '  合法答案  ')
    expect(scenario.guessOf(player.playerId, 2)).toBe('合法答案')
  })

  it('重复提交 / 旧步 id / 非猜词阶段分别按既有错误码拒绝', () => {
    const scenario = atGuessStep()
    const player = scenario.players[0]
    if (!player) throw new Error('场景缺少玩家')
    const stepTwoId = scenario.stepId

    scenario.harness.service.submitRelayGuess(player.playerId, stepTwoId, '第一次')
    expect(
      errorCodeOf(() =>
        scenario.harness.service.submitRelayGuess(player.playerId, stepTwoId, '第二次'),
      ),
    ).toBe(ERROR_CODES.ALREADY_SUBMITTED)
    expect(
      errorCodeOf(() =>
        scenario.harness.service.submitRelayGuess(
          player.playerId,
          '00000000-0000-4000-8000-0000000000d2',
          '旧包',
        ),
      ),
    ).toBe(ERROR_CODES.STALE_DRAW_EVENT)

    // 换手到步 3 作画后，猜词提交一律按「当前不能猜词」拒绝（旧步 id 先命中旧包码）
    scenario.submitAllGuesses()
    expect(scenario.room.phase).toBe('relay_draw')
    expect(
      errorCodeOf(() =>
        scenario.harness.service.submitRelayGuess(player.playerId, stepTwoId, '迟到'),
      ),
    ).toBe(ERROR_CODES.STALE_DRAW_EVENT)
    expect(
      errorCodeOf(() =>
        scenario.harness.service.submitRelayGuess(player.playerId, scenario.stepId, '阶段不对'),
      ),
    ).toBe(ERROR_CODES.INVALID_PHASE)
  })

  it('猜词超时：未提交者由服务端代交「？」，四条链都进入下一棒', () => {
    const scenario = atGuessStep()

    scenario.harness.runtime.advance(scenario.room.settings.relayGuessSeconds * 1_000)

    expect(scenario.room.phase).toBe('relay_draw')
    expect(scenario.relay.currentStep).toBe(3)
    // 代交口径（S16）：猜词交「当前输入框内容」，输入为空则「？」——
    // 线上没有承载未提交草稿的通道，服务端观测不到草稿，因此固定兜底「？」（见状态机注释）
    for (const chain of scenario.relay.chains) expect(chain.step2Guess).toBe('？')
    // 步 3 的题面就是这句代交文本（每人自己快照里的 prompt）
    for (const player of scenario.players) {
      expect(scenario.snapshotOf(player.playerId).relay?.prompt).toBe('？')
    }
  })
})

describe('接龙步 3 按答案作画', () => {
  it('题面＝上家猜出的文本、画布是自己的第二幅：看不到上家的画，也看不到上家原本的题面', () => {
    const scenario = atSecondDrawingStepWithPaintedFirstHalf()
    const viewer = scenario.players[0]
    if (!viewer) throw new Error('场景缺少玩家')
    // 我本棒负责的链（步 3）＝自己那条链向前回退 2 条：它的步 2 产出就是我的题面
    const painterChain = scenario.chainOf(viewer.playerId, 3)
    const prompt = painterChain.step2Guess
    if (!prompt) throw new Error('步 2 缺少产出')
    // 这条链的第一幅画是链发起人在步 1 画的：步 3 绝不允许把它（或它的一笔）下发
    const hiddenStrokeId = painterChain.step1Canvas.strokes[0]?.id
    if (!hiddenStrokeId) throw new Error('第一幅画缺少笔画，隐私断言将形同虚设')
    // 出题者＝在这条链上做步 2 的那位（站在我前面一位的玩家）
    const prompter = scenario.players.find(
      (player) => scenario.chainOf(player.playerId, 2) === painterChain,
    )
    if (!prompter) throw new Error('场景缺少出题者')

    const view = scenario.snapshotOf(viewer.playerId).relay
    expect(view?.phase).toBe('relay_draw')
    expect(view?.currentStep).toBe(3)
    expect(view?.prompt).toBe(prompt)
    expect(view?.ownCanvas?.strokes).toEqual(painterChain.step3Canvas.strokes)
    expect(view?.previousDrawing).toBeUndefined()

    // 隐私硬约束：既不下发上家的第一幅画，也不下发该链原本的题面（自己那条链的 step1Word），
    // 其余链的第一幅画同样一个都不出现
    const serialized = JSON.stringify(scenario.snapshotOf(viewer.playerId))
    expect(serialized).not.toContain(hiddenStrokeId)
    for (const chain of scenario.relay.chains) {
      for (const command of chain.step1Canvas.strokes) {
        if (command.id === hiddenStrokeId) continue
        expect(serialized, `泄漏了其它链的第一幅画 ${command.id}`).not.toContain(command.id)
      }
      const word = chain.step1Word?.text
      if (word) expect(serialized, `泄漏了题面 ${word}`).not.toContain(word)
    }
    // 上家 chip 是出题者（不带画笔角标的那位）：客户端据此渲染「谁给了我这句话」
    expect(view?.previousArtist?.id).toBe(prompter.playerId)
  })

  it('第二幅画的命令不污染第一幅，提交满即秒切步 4', () => {
    const scenario = atSecondDrawingStep()
    const players = scenario.players
    const stepThreeId = scenario.stepId
    const firstCanvasBefore = players.map((player) => scenario.canvasOf(player.playerId, 1))

    scenario.harness.service.addRelayStroke(
      players[0]?.playerId ?? '',
      stepThreeId,
      dotStroke(0, 'second-half-0'),
    )
    for (const player of players)
      scenario.harness.service.submitRelayDrawing(player.playerId, stepThreeId)

    expect(scenario.room.phase).toBe('relay_guess')
    expect(scenario.relay.currentStep).toBe(4)
    expect(scenario.relay.stepId).not.toBe(stepThreeId)
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(
      scenario.room.settings.relayGuessSeconds * 1_000,
    )
    expect(
      scenario.notices().filter((text) => text === serverStrings.notices.relayStepStarted(4)),
    ).toHaveLength(1)
    // 步 3 只写第二幅画布：第一幅保持原样（每幅画独立计数，S45）
    expect(scenario.canvasOf(players[0]?.playerId ?? '', 3).strokes.map((s) => s.id)).toEqual([
      'second-half-0',
    ])
    players.forEach((player, index) => {
      expect(scenario.canvasOf(player.playerId, 1)).toEqual(firstCanvasBefore[index])
    })
  })

  it('作画超时：代交＝已有笔画（未画则空白画布），不写任何兜底内容', () => {
    const scenario = atSecondDrawingStep()
    const players = scenario.players
    const painter = players[0]
    if (!painter) throw new Error('场景缺少玩家')
    scenario.harness.service.addRelayStroke(
      painter.playerId,
      scenario.stepId,
      dotStroke(0, 'half-drawn'),
    )

    scenario.harness.runtime.advance(scenario.room.settings.relayDrawSeconds * 1_000)

    expect(scenario.room.phase).toBe('relay_guess')
    expect(scenario.relay.currentStep).toBe(4)
    // 未提交者交的是「当前已有全部笔画」：画过的保留，没画的保持空白画布
    expect(scenario.canvasOf(painter.playerId, 3).strokes.map((s) => s.id)).toEqual(['half-drawn'])
    const untouched = players[1]
    if (!untouched) throw new Error('场景缺少玩家')
    expect(scenario.canvasOf(untouched.playerId, 3).strokes).toEqual([])
    // 步 4 只下发上家的第二幅画（代交后的成品）
    const view = scenario.snapshotOf(players[2]?.playerId ?? '').relay
    expect(view?.phase).toBe('relay_guess')
    expect(view?.currentStep).toBe(4)
    expect(view?.prompt).toBeUndefined()
    expect(view?.ownCanvas).toBeUndefined()
  })
})

describe('接龙步 4 与复盘入口', () => {
  it('步 4 只看上家的第二幅画：画者 chip 是画那幅画的人（不是链发起人）', () => {
    const scenario = atSecondDrawingStep()
    const players = scenario.players
    // 每位画家在第二幅画上各留一笔，便于断言「我看到的正是那位画者的画」
    for (const player of players) {
      scenario.harness.service.addRelayStroke(
        player.playerId,
        scenario.stepId,
        dotStroke(0, `half2-${player.playerId.slice(-2)}`),
      )
    }
    scenario.submitAllDrawings()

    const viewer = players[0]
    if (!viewer) throw new Error('场景缺少玩家')
    const paintedChain = scenario.chainOf(viewer.playerId, 4)
    // 第二幅画的画者＝在这条链上动手画第二幅的那位（步 3 的动手者，链 j 的第 3 棒）
    const painter = players.find((player) => scenario.chainOf(player.playerId, 3) === paintedChain)
    if (!painter) throw new Error('场景缺少第二幅画的画者')
    expect(painter.playerId).not.toBe(paintedChain.originPlayerId)

    const view = scenario.snapshotOf(viewer.playerId).relay
    expect(view?.currentStep).toBe(4)
    expect(view?.previousDrawing?.strokes).toEqual(paintedChain.step3Canvas.strokes)
    expect(view?.previousArtist?.id).toBe(painter.playerId)
    expect(view?.previousArtist?.nickname).toBe(painter.nickname)
  })

  it('步 4 全员提交后进入复盘阶段并停止对局计时（复盘时序归工单 07）', () => {
    const scenario = startRelayGame()

    scenario.playToShowcase()

    expect(scenario.room.phase).toBe('relay_showcase')
    expect(scenario.relay.currentStep).toBe(4)
    // 四步走完：每条链都有题面、两句答案与两幅画
    for (const chain of scenario.relay.chains) {
      expect(chain.step1Word).toBeDefined()
      expect(chain.step2Guess).toBeDefined()
      expect(chain.step4Guess).toBeDefined()
    }
    const phaseAtShowcase = scenario.room.phase
    // 对局计时已停：再推进超过「选词 + 作画 + 猜词」的时长也不会自行换棒或回到 waiting
    const relayStepBudgetMs =
      (APP_CONFIG.relay.chooseSeconds.default +
        APP_CONFIG.relay.drawSeconds.default +
        APP_CONFIG.relay.guessSeconds.default) *
      1_000
    scenario.harness.runtime.advance(relayStepBudgetMs)
    expect(scenario.room.phase).toBe(phaseAtShowcase)
    expect(scenario.room.relay?.currentStep).toBe(4)
    expect(scenario.snapshotOf(scenario.host.playerId).relay?.phase).toBe('relay_showcase')
  })
})

describe('接龙掉队代交与离开者占位', () => {
  it('断线宽限先到：超短宽限后由服务端代交「？」，代交即锁定，其余人不被拖住', () => {
    const scenario = atGuessStep()
    const players = scenario.players
    const offline = players[0]
    const others = players.slice(1)
    if (!offline) throw new Error('场景缺少玩家')

    scenario.disconnect(offline)
    // 短宽限（20 秒）先于猜词倒计时（45 秒）到点：离线者被代交，本棒随即秒切
    scenario.harness.runtime.advance(APP_CONFIG.network.drawerReconnectGraceMs)

    expect(scenario.room.phase).toBe('relay_guess')
    expect(scenario.relay.currentStep).toBe(2)
    expect(scenario.guessOf(offline.playerId, 2)).toBe('？')

    // 代交即锁定：离线者重连后不能再改写本棒答案（两条代交路径共用一个提交集去重）
    scenario.reconnect(offline)
    expect(
      errorCodeOf(() =>
        scenario.harness.service.submitRelayGuess(offline.playerId, scenario.stepId, '我的真答案'),
      ),
    ).toBe(ERROR_CODES.ALREADY_SUBMITTED)
    expect(scenario.guessOf(offline.playerId, 2)).toBe('？')

    // 其余人交完即秒切步 3：离线者（已被代交）不再拖住全房
    for (const player of others) {
      scenario.harness.service.submitRelayGuess(
        player.playerId,
        scenario.stepId,
        `答案-${player.nickname}`,
      )
    }
    expect(scenario.room.phase).toBe('relay_draw')
    expect(scenario.relay.currentStep).toBe(3)
  })

  it('宽限内重连可续接当前步：本人提交照常生效，宽限到点不二次代交', () => {
    const scenario = atGuessStep()
    const players = scenario.players
    const offline = players[0]
    if (!offline) throw new Error('场景缺少玩家')
    const stepTwoId = scenario.stepId

    scenario.disconnect(offline)
    for (const player of players.slice(1)) {
      scenario.harness.service.submitRelayGuess(
        player.playerId,
        scenario.stepId,
        `答案-${player.nickname}`,
      )
    }
    // 宽限内（差 1 秒）仍在当前步：席位与棒次都保留（S8）
    scenario.harness.runtime.advance(APP_CONFIG.network.drawerReconnectGraceMs - 1_000)
    expect(scenario.room.phase).toBe('relay_guess')
    expect(scenario.relay.stepId).toBe(stepTwoId)

    scenario.reconnect(offline)
    scenario.harness.service.submitRelayGuess(offline.playerId, stepTwoId, '我回来了')

    expect(scenario.room.phase).toBe('relay_draw')
    expect(scenario.guessOf(offline.playerId, 2)).toBe('我回来了')

    // 宽限到点后旧计时器再触发：步已换手，代交路径一律让路（不重复代交）
    const stepThreeId = scenario.stepId
    scenario.harness.runtime.advance(APP_CONFIG.network.drawerReconnectGraceMs)
    expect(scenario.room.phase).toBe('relay_draw')
    expect(scenario.relay.currentStep).toBe(3)
    expect(scenario.relay.stepId).toBe(stepThreeId)
  })

  it('长期掉线者进入新棒即被代交：其余人交完立即秒切，不必再等一个宽限', () => {
    const scenario = startRelayGame()
    const players = scenario.players
    const offline = players[0]
    const others = players.slice(1)
    if (!offline) throw new Error('场景缺少玩家')

    scenario.chooseAll()
    scenario.disconnect(offline)
    // 步 1 作画：宽限到点即代交（作画＝已有笔画），其余人交完即秒切步 2
    scenario.harness.runtime.advance(APP_CONFIG.network.drawerReconnectGraceMs)
    scenario.submitAllDrawings()
    expect(scenario.relay.currentStep).toBe(2)

    // 进入步 2 的当下（没有再推进时钟）宽限早已用完：离线者被立即代交「？」，本棒不再有等待
    expect(scenario.guessOf(offline.playerId, 2)).toBe('？')
    for (const player of others) {
      scenario.harness.service.submitRelayGuess(
        player.playerId,
        scenario.stepId,
        `答案-${player.nickname}`,
      )
    }
    expect(scenario.room.phase).toBe('relay_draw')
    expect(scenario.relay.currentStep).toBe(3)
  })

  it('退局者仍占链位：本步立即代交，后续每步自动代交，人数掉到 4 以下不中止', () => {
    const scenario = atGuessStep()
    const players = scenario.players
    const leaver = players[0]
    if (!leaver) throw new Error('场景缺少玩家')
    const chainsBefore = scenario.relay.chains.length

    // 主动退出本局：房间保留一张冻结成绩卡，链位由占位代交承接（S37 / S7）
    scenario.harness.service.leaveGame(leaver.playerId)

    expect(scenario.room.members.filter((member) => member.leftGame)).toHaveLength(1)
    // 链数组不变：离开者仍占链位，代交在本步立即发生（其余人不必等他）
    expect(scenario.relay.chains).toHaveLength(chainsBefore)
    scenario.submitAllGuesses()
    expect(scenario.room.phase).toBe('relay_draw')
    expect(scenario.relay.currentStep).toBe(3)
    expect(scenario.guessOf(leaver.playerId, 2)).toBe('？')

    // 后续每步自动代交：作画步（已有笔画）与猜词步（「？」）都不卡链
    scenario.submitAllDrawings()
    expect(scenario.relay.currentStep).toBe(4)
    scenario.submitAllGuesses()
    expect(scenario.room.phase).toBe('relay_showcase')
    expect(scenario.guessOf(leaver.playerId, 4)).toBe('？')
    // 只剩下的 3 人（< 4）也照常走完：没有暂停、也没有中止本局
    expect(scenario.relay.chains).toHaveLength(chainsBefore)
    expect(scenario.room.relay).toBeDefined()
  })

  it('两名成员离房（可玩人数掉到 4 以下）仍走完四步：链位与产出都保留', () => {
    const scenario = startRelayGame()
    const players = scenario.players
    const [first, second] = players
    if (!first || !second) throw new Error('场景缺少玩家')

    // 开局后立刻一人离房、一人退局：两条离场路径都不动链位，本步交回给占位代交
    scenario.harness.service.leaveRoom(first.playerId)
    scenario.harness.service.leaveGame(second.playerId)
    expect(scenario.room.members).toHaveLength(players.length - 1)
    expect(scenario.room.relay).toBeDefined()

    scenario.playToShowcase()

    expect(scenario.room.phase).toBe('relay_showcase')
    for (const player of [first, second]) {
      expect(scenario.guessOf(player.playerId, 2)).toBe('？')
      expect(scenario.guessOf(player.playerId, 4)).toBe('？')
    }
  })

  it('步 4 猜词超时同样进入复盘：未提交者代交「？」，链绝不断', () => {
    const scenario = startRelayGame()
    scenario.chooseAll()
    scenario.submitAllDrawings()
    scenario.submitAllGuesses()
    scenario.submitAllDrawings()
    expect(scenario.relay.currentStep).toBe(4)

    scenario.harness.runtime.advance(scenario.room.settings.relayGuessSeconds * 1_000)

    expect(scenario.room.phase).toBe('relay_showcase')
    for (const chain of scenario.relay.chains) expect(chain.step4Guess).toBe('？')
  })

  it('四步顺序：每一步换手都推进一棒，步号单调走到复盘', () => {
    const scenario = startRelayGame()
    const stepsSeen: number[] = []

    scenario.chooseAll()
    stepsSeen.push(scenario.relay.currentStep)
    scenario.submitAllDrawings()
    stepsSeen.push(scenario.relay.currentStep)
    scenario.submitAllGuesses()
    stepsSeen.push(scenario.relay.currentStep)
    scenario.submitAllDrawings()
    stepsSeen.push(scenario.relay.currentStep)
    scenario.submitAllGuesses()
    stepsSeen.push(scenario.relay.currentStep)

    expect(stepsSeen).toEqual([1, 2, 3, 4, 4])
    expect(scenario.room.phase).toBe('relay_showcase')
    expect(scenario.relay.chains.every((chain) => chain.step2Guess && chain.step4Guess)).toBe(true)
  })

  it('每条链只有本棒的动手者参与：步 2/4 的答案归属由环状顺延决定（S9）', () => {
    const scenario = atGuessStep()
    const guessAnswers = new Map(
      scenario.players.map((player) => [player.playerId, `答案-${player.nickname}`]),
    )
    scenario.submitAllGuesses((player) => guessAnswers.get(player.playerId) ?? '兜底')
    const stepFourAnswers = new Map(
      scenario.players.map((player) => [player.playerId, `第二轮-${player.nickname}`]),
    )
    scenario.submitAllDrawings()
    scenario.submitAllGuesses((player) => stepFourAnswers.get(player.playerId) ?? '兜底')

    // 每条链上：步 2 的答案是某位玩家给的、步 4 的答案是另一位给的，且都不是链发起人自己
    for (const chain of scenario.relay.chains) {
      const answerOwners = scenario.players.filter(
        (player) => scenario.chainOf(player.playerId, 2) === chain,
      )
      expect(answerOwners).toHaveLength(1)
      const owner: RelayTestPlayer | undefined = answerOwners[0]
      expect(chain.step2Guess).toBe(owner ? guessAnswers.get(owner.playerId) : undefined)
      const fourthOwners = scenario.players.filter(
        (player) => scenario.chainOf(player.playerId, 4) === chain,
      )
      expect(fourthOwners[0]?.playerId).not.toBe(owner?.playerId)
      expect(chain.step4Guess).toBe(
        fourthOwners[0] ? stepFourAnswers.get(fourthOwners[0].playerId) : undefined,
      )
    }
  })
})
