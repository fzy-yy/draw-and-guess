/**
 * 接龙复盘轮播（工单 07；S11 / S12 / S32 / S35 / S43 / S63 / S65 / S66）。
 *
 * 断言口径（只用外部可观察行为：快照载荷、游标读数、ack 错误码、系统通知、假时钟推进）：
 * - 轮播顺序＝链发起人**席位顺序**（S11），每条链从半场 1 的重播页起跑；
 * - 每页时长取自配置包（重播 / 停顿 / 揭晓，S43），两条半场共 14s 后切入该链投票并**保留游标**；
 * - 展示期快照只公开**当前链**：本半场的题面、画作（全量 strokes，S32）与答案；
 *   未揭晓的答案 text 为 null——既不下发文本也不下发长度（S81），其余链一律不下发（哨兵扫描）；
 * - 展示期完全不可干预（S12）：提前结束 / 提交 / 选词 / 暂停一律按既有错误码拒绝，且不改变现场；
 * - 成员离房 / 退局 / 掉线超宽限都不中止轮播（S12 / S7），身份已回收时 chip 用中性占位身份兜底；
 * - 关键节点通知只在「复盘开始」与「每条链展示开始」播（S65），页推进一条都不播。
 */
import { describe, expect, it } from 'vitest'
import { ERROR_CODES, type Stroke } from '@draw-guess/shared'
import { serverStrings } from '@draw-guess/strings'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import type { RelayShowcasePage } from '../../apps/server/src/domain/relay/relay-showcase.ts'
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

/** 测试侧独立算式：第 index 名玩家在第 step 棒动手的那条链的下标（S9 的环状顺延）。 */
function chainIndexAt(playerIndex: number, step: number, chainCount: number): number {
  return (playerIndex - (step - 1) + chainCount) % chainCount
}

/** 某观看者快照里的复盘内容（未进入复盘轮播时为 undefined）。 */
function showcaseOf(scenario: RelayGameScenario, playerId: string) {
  return scenario.snapshotOf(playerId).relay?.showcase
}

/** 递归收集 JSON 里的全部数字：用于断言「未揭晓答案的字数」没有以任何数值形式泄露。 */
function collectNumbers(value: unknown, found: number[] = []): number[] {
  if (typeof value === 'number') found.push(value)
  else if (Array.isArray(value)) value.forEach((item) => collectNumbers(item, found))
  else if (value && typeof value === 'object')
    Object.values(value).forEach((item) => collectNumbers(item, found))
  return found
}

/** 每条链的哨兵内容：题面（自定义词）、两句答案、两幅画各一笔。 */
interface SentinelContent {
  promptOf(chainIndex: number): string
  step2Of(chainIndex: number): string
  step4Of(chainIndex: number): string
  strokeOf(chainIndex: number, half: 1 | 2): string
}

/**
 * 走到复盘入口，并给每条链留下可辨识的哨兵内容（走真实事件路径）：
 * 自定义题目 → 两幅画各一笔 → 步 2 / 步 4 各提交一句带链标记的答案。
 * 链归属由测试侧的 `chainIndexAt` 给出，与被测实现的环状顺延互为参照。
 */
function playToShowcaseWithSentinels(): {
  scenario: RelayGameScenario
  content: SentinelContent
} {
  const scenario = startRelayGame({ settings: { allowCustomWord: true } })
  const chainCount = scenario.relay.chains.length
  const promptOf = (chainIndex: number) => `题面-链${chainIndex + 1}`
  const step2Of = (chainIndex: number) => `首答-链${chainIndex + 1}`
  const step4Of = (chainIndex: number) => `末答-链${chainIndex + 1}`
  const strokeOf = (chainIndex: number, half: 1 | 2) => `笔画-链${chainIndex + 1}-${half}`
  const chainOfPlayer = (player: RelayTestPlayer, step: number) =>
    chainIndexAt(scenario.players.indexOf(player), step, chainCount)

  // 步 1：全员各选自定义题面（选满即秒切作画）。笔画只为第 1 / 2 条链留哨兵——
  // 其余链保持**空白画布**，供 S66 的用例断言「空白保持空白、不加标注」。
  scenario.players.forEach((player) =>
    scenario.harness.service.chooseCustomWord(
      player.playerId,
      scenario.stepId,
      promptOf(chainOfPlayer(player, 1)),
    ),
  )
  scenario.players.forEach((player, playerIndex) => {
    if (playerIndex >= 2) return
    scenario.harness.service.addRelayStroke(
      player.playerId,
      scenario.stepId,
      dotStroke(0, strokeOf(chainOfPlayer(player, 1), 1)),
    )
  })
  scenario.submitAllDrawings()
  // 步 2 / 步 3 / 步 4：答案同样按链归属留哨兵；第二幅画只为第 1 / 2 条链留（玩家 3、4 的步 3 落在链 1 / 2）
  scenario.submitAllGuesses((player) => step2Of(chainOfPlayer(player, 2)))
  scenario.players.forEach((player, playerIndex) => {
    if (playerIndex < 2) return
    scenario.harness.service.addRelayStroke(
      player.playerId,
      scenario.stepId,
      dotStroke(0, strokeOf(chainOfPlayer(player, 3), 2)),
    )
  })
  scenario.submitAllDrawings()
  scenario.submitAllGuesses((player) => step4Of(chainOfPlayer(player, 4)))

  return { scenario, content: { promptOf, step2Of, step4Of, strokeOf } }
}

describe('接龙复盘轮播（工单 07）', () => {
  it('从第 1 条链的半场 1 重播页起跑：游标三维、阶段窗口＝重播时长、全员同一份（S11 / S35 / S43）', () => {
    const { scenario, content } = playToShowcaseWithSentinels()
    const firstChain = scenario.relay.chains[0]
    const secondPlayer = scenario.players[1]
    if (!firstChain || !secondPlayer) throw new Error('场景缺少链或玩家')

    expect(scenario.room.phase).toBe('relay_showcase')
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 1, page: 'replay' })
    // 阶段窗口就是本页时长（重播页 3s，S43）：客户端据此播放重放动画
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(3_000)

    for (const player of scenario.players) {
      const showcase = showcaseOf(scenario, player.playerId)
      // 复盘是公开内容：每个观看者拿到的都是同一条链的同一份内容（S35），不按观看者裁剪
      expect(showcase?.chainIndex, `观看者 ${player.nickname}`).toBe(1)
      expect(showcase?.chainCount).toBe(scenario.players.length)
      expect(showcase?.half).toBe(1)
      // 左胶囊＝链发起人（带画笔角标的画家）与他选的词
      expect(showcase?.prompt.player.id).toBe(firstChain.originPlayerId)
      expect(showcase?.prompt.player.nickname).toBe(scenario.players[0]?.nickname)
      expect(showcase?.prompt.text).toBe(content.promptOf(0))
      // 右胶囊＝第二棒的猜词者 chip，重播页**未揭晓**（S81）
      expect(showcase?.answer.player.id).toBe(secondPlayer.playerId)
      expect(showcase?.answer.text).toBeNull()
      // 画作＝该链第一幅，全量 strokes 下发（S32）
      expect(showcase?.drawing.strokes).toEqual(firstChain.step1Canvas.strokes)
      expect(showcase?.drawing.strokes.map((command) => command.id)).toEqual([
        content.strokeOf(0, 1),
      ])
    }
  })

  it('半场时序：重播 → 停顿 → 揭晓，两半场后切入该链投票并保留游标（S43）', () => {
    const { scenario, content } = playToShowcaseWithSentinels()
    const viewer = scenario.host
    const firstChain = scenario.relay.chains[0]
    const secondGuesser = scenario.players[1]
    const fourthGuesser = scenario.players[3]
    if (!firstChain || !secondGuesser || !fourthGuesser) throw new Error('场景缺少链或玩家')

    // 半场 1 · 重播 → 停顿：同一半场与同一画作，答案仍未揭晓，阶段窗口＝停顿时长（1s）
    expect(showcaseOf(scenario, viewer.playerId)?.answer.text).toBeNull()
    scenario.advanceShowcasePage()
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 1, page: 'pause' })
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(1_000)
    expect(showcaseOf(scenario, viewer.playerId)?.answer.text).toBeNull()

    // 半场 1 · 揭晓：答案出现（＝第二棒的猜词），时长 3s
    scenario.advanceShowcasePage()
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 1, page: 'reveal' })
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(3_000)
    expect(showcaseOf(scenario, viewer.playerId)?.answer.text).toBe(content.step2Of(0))

    // 半场 2 · 重播：题面换成第二棒的答案、画作换成第三棒的第二幅画，第四棒的答案仍未揭晓
    scenario.advanceShowcasePage()
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 2, page: 'replay' })
    const secondHalf = showcaseOf(scenario, viewer.playerId)
    expect(secondHalf?.prompt.text).toBe(content.step2Of(0))
    expect(secondHalf?.answer.player.id).toBe(fourthGuesser.playerId)
    expect(secondHalf?.answer.text).toBeNull()
    expect(secondHalf?.drawing.strokes).toEqual(firstChain.step3Canvas.strokes)
    expect(secondHalf?.drawing.strokes.map((command) => command.id)).toEqual([
      content.strokeOf(0, 2),
    ])

    // 半场 2 · 揭晓 → 该链展示结束：切入投票，游标**保留**在「半场 2 · 揭晓」
    scenario.advanceShowcasePage()
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 2, page: 'pause' })
    scenario.advanceShowcasePage()
    expect(showcaseOf(scenario, viewer.playerId)?.answer.text).toBe(content.step4Of(0))
    scenario.advanceShowcasePage()
    expect(scenario.room.phase).toBe('relay_vote')
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 2, page: 'reveal' })
    // 投票期的快照仍是这条链，且两个答案都已揭晓（投票卡要并排展示两个答案，S78）
    const voteView = showcaseOf(scenario, viewer.playerId)
    expect(voteView?.prompt.text).toBe(content.step2Of(0))
    expect(voteView?.answer.text).toBe(content.step4Of(0))
    // 投票窗口由工单 08 的收票状态机写入：固定 relay.voteSeconds，到点才结算（S21）
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(
      APP_CONFIG.relay.voteSeconds * 1_000,
    )
    // 票行此刻还没有任何票（只有投票期才下发该字段）
    expect(voteView?.votes).toEqual([])
  })

  it('每链展示总时长＝14s（2 × (3+1+3)，S43）：到点前 1ms 仍在揭晓页，到点才切投票', () => {
    const { scenario } = playToShowcaseWithSentinels()
    // 时长全部取自配置包（禁止魔法数字）；这里顺带把 S43 的规格值钉死
    const replayMs = APP_CONFIG.relay.replaySeconds * 1_000
    const pauseMs = APP_CONFIG.relay.replayPauseSeconds * 1_000
    const revealMs = APP_CONFIG.relay.revealSeconds * 1_000
    expect([replayMs, pauseMs, revealMs]).toEqual([3_000, 1_000, 3_000])
    const chainShowcaseMs = 2 * (replayMs + pauseMs + revealMs)
    expect(chainShowcaseMs).toBe(14_000)

    scenario.harness.runtime.advance(chainShowcaseMs - 1)

    expect(scenario.room.phase).toBe('relay_showcase')
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 2, page: 'reveal' })

    scenario.harness.runtime.advance(1)

    expect(scenario.room.phase).toBe('relay_vote')
  })

  it('链与链按席位顺序串起来：接管入口逐条推进，每次只展示当条链（S11 / S23）', () => {
    const { scenario, content } = playToShowcaseWithSentinels()
    const chainCount = scenario.relay.chains.length
    const seen: number[] = []

    // 第 1 条链展示结束 → 投票；08 在投票结束后用同一入口继续下一条链
    for (let chainIndex = 1; chainIndex <= chainCount; chainIndex += 1) {
      expect(scenario.showcaseCursor()).toEqual({ chainIndex, half: 1, page: 'replay' })
      const showcase = showcaseOf(scenario, scenario.host.playerId)
      const chain = scenario.relay.chains[chainIndex - 1]
      if (!chain) throw new Error('场景缺少链')
      // 展示的正是第 chainIndex 条链（数组顺序＝发起人席位升序）：题面与画作都取自它
      expect(showcase?.prompt.player.id).toBe(chain.originPlayerId)
      expect(showcase?.prompt.text).toBe(content.promptOf(chainIndex - 1))
      expect(showcase?.chainIndex).toBe(chainIndex)
      seen.push(chainIndex)

      scenario.finishShowcaseChain()
      expect(scenario.room.phase).toBe('relay_vote')
      if (chainIndex < chainCount)
        scenario.harness.service.relay.beginShowcaseForChain(scenario.room, chainIndex + 1)
    }

    expect(seen).toEqual([1, 2, 3, 4])
    // 全部链走完：游标停在第 N 条链的最后一个半场揭晓页，等 08 收票并进终局
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: chainCount, half: 2, page: 'reveal' })
  })

  it('展示期只公开当前链：其余链的题面、答案与笔画一律不进任何人的快照（S32 / S35 / S63）', () => {
    const { scenario, content } = playToShowcaseWithSentinels()
    const chainCount = scenario.relay.chains.length
    const allSentinels = scenario.relay.chains.flatMap((_chain, chainIndex) => [
      content.promptOf(chainIndex),
      content.step2Of(chainIndex),
      content.step4Of(chainIndex),
      content.strokeOf(chainIndex, 1),
      content.strokeOf(chainIndex, 2),
    ])
    const pages: { half: 1 | 2; page: RelayShowcasePage }[] = [
      { half: 1, page: 'replay' },
      { half: 1, page: 'pause' },
      { half: 1, page: 'reveal' },
      { half: 2, page: 'replay' },
      { half: 2, page: 'pause' },
      { half: 2, page: 'reveal' },
    ]

    for (const cursor of pages) {
      expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, ...cursor })
      // 本页允许出现的内容：本半场的题面 + 本半场的画作（半场 2 不再重发第一幅）；揭晓页才加答案
      const allowed = [
        cursor.half === 1 ? content.promptOf(0) : content.step2Of(0),
        content.strokeOf(0, cursor.half),
        ...(cursor.page === 'reveal'
          ? [cursor.half === 1 ? content.step2Of(0) : content.step4Of(0)]
          : []),
      ]
      for (const player of scenario.players) {
        const serialized = JSON.stringify(scenario.snapshotOf(player.playerId))
        const label = `${player.nickname} / 第 ${cursor.half} 半场 ${cursor.page} 页`
        for (const sentinel of allSentinels) {
          if (allowed.includes(sentinel)) continue
          expect(serialized, `${label}：泄漏了 ${sentinel}`).not.toContain(sentinel)
        }
        for (const sentinel of allowed) expect(serialized, label).toContain(sentinel)
      }
      scenario.advanceShowcasePage()
    }

    expect(scenario.room.phase).toBe('relay_vote')
    expect(chainCount).toBe(scenario.players.length)
  })

  it('未揭晓的答案不下发文本也不下发长度（S81）：text 为 null，无遮罩、无等于字数的数值', () => {
    const { scenario, content } = playToShowcaseWithSentinels()
    const hidden = content.step2Of(0)
    const viewer = scenario.host

    const view = showcaseOf(scenario, viewer.playerId)
    expect(view?.answer.text).toBeNull()
    const snapshot = scenario.snapshotOf(viewer.playerId)
    const serialized = JSON.stringify(snapshot)
    // 文本不泄露
    expect(serialized).not.toContain(hidden)
    // 长度也不泄露：服务端一个遮罩字符都不发（占位是客户端按固定位数 `relay.hiddenAnswerChars` 画的）
    expect(serialized).not.toContain('＿')
    // 长度泄露的第二道防线：复盘骨架与胶囊里不存在与答案字数相等的数值
    // （画作内部另有笔画宽度、坐标等内容数字，不是长度载体，故比对时排除 drawing 子树）
    const hiddenLength = Array.from(hidden).length
    const { drawing: _drawing, ...withoutDrawing } = view ?? {}
    expect(collectNumbers(withoutDrawing)).not.toContain(hiddenLength)
    // 未揭晓只表达为「右胶囊的 text 为 null」，胶囊本身（猜词者 chip）必须还在（S81 的占位要贴人）
    expect(view?.answer.player.id).toBe(scenario.players[1]?.playerId)
  })

  it('空白画布保持空白：不加标注、不造占位内容（S66）', () => {
    const { scenario } = playToShowcaseWithSentinels()
    // 第 3 条链没人动过笔（哨兵只画了第 1 / 2 半场里各自链的一笔，第三条链两幅都空）
    const blank = scenario.relay.chains[2]
    if (!blank) throw new Error('场景缺少链')

    scenario.finishShowcaseChain()
    scenario.harness.service.relay.beginShowcaseForChain(scenario.room, 2)
    scenario.finishShowcaseChain()
    scenario.harness.service.relay.beginShowcaseForChain(scenario.room, 3)

    expect(blank.step1Canvas.strokes).toEqual([])
    expect(blank.step3Canvas.strokes).toEqual([])
    const showcase = showcaseOf(scenario, scenario.host.playerId)
    expect(showcase?.drawing.strokes).toEqual([])
    expect(showcase?.drawing.undoneStrokeIds).toEqual([])
    // 画布之外也没有任何「空白画布」标注：快照里不出现任何额外文案字段（S66）
    expect(Object.keys(showcase ?? {})).toEqual([
      'chainIndex',
      'chainCount',
      'half',
      'prompt',
      'answer',
      'drawing',
    ])
  })

  it('展示期完全不可干预：跳过 / 提前结束 / 提交 / 选词 / 暂停一律拒绝，且现场原样（S12）', () => {
    const { scenario } = playToShowcaseWithSentinels()
    const host = scenario.host
    const service = scenario.harness.service
    const before = {
      cursor: scenario.showcaseCursor(),
      phaseStartedAt: scenario.relay.phaseStartedAt,
      phaseEndsAt: scenario.relay.phaseEndsAt,
    }

    // 房主提前结束：复盘期没有这个入口（S12）
    expect(errorCodeOf(() => service.endEarly(host.playerId))).toBe(ERROR_CODES.INVALID_PHASE)
    // 提交 / 选词：非对应阶段被拒——没有任何一条路径能替别人把展示翻页
    expect(
      errorCodeOf(() => service.submitRelayDrawing(host.playerId, scenario.relay.stepId)),
    ).toBe(ERROR_CODES.NOT_DRAWER)
    expect(
      errorCodeOf(() => service.submitRelayGuess(host.playerId, scenario.relay.stepId, '抢跑')),
    ).toBe(ERROR_CODES.INVALID_PHASE)
    expect(
      errorCodeOf(() => service.chooseWord(host.playerId, scenario.relay.stepId, '抢跑')),
    ).toBe(ERROR_CODES.INVALID_PHASE)
    // 暂停：接龙禁用暂停（S19），展示期同样不可暂停
    expect(errorCodeOf(() => service.pause(host.playerId, '想停一下'))).toBe(
      ERROR_CODES.INVALID_PHASE,
    )
    // 内部接管入口也守规矩：展示期内调它（＝跳链）在阶段转换白名单上失败
    expect(errorCodeOf(() => service.relay.beginShowcaseForChain(scenario.room, 3))).toBe(
      ERROR_CODES.INVALID_TRANSITION,
    )
    // 越界的链序号显式失败，绝不静默换一条链展示
    expect(errorCodeOf(() => service.relay.beginShowcaseForChain(scenario.room, 9))).toBe(
      ERROR_CODES.INTERNAL_ERROR,
    )

    // 全部拒绝都没有动过现场：游标、阶段时间与轮播进度原样
    expect(scenario.showcaseCursor()).toEqual(before.cursor)
    expect(scenario.relay.phaseStartedAt).toBe(before.phaseStartedAt)
    expect(scenario.relay.phaseEndsAt).toBe(before.phaseEndsAt)
    scenario.advanceShowcasePage()
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 1, page: 'pause' })
  })

  it('成员离房 / 退局不中止轮播：展示与快照照常走完，离开者的链仍按序展示（S7 / S12）', () => {
    const { scenario, content } = playToShowcaseWithSentinels()
    const [firstOrigin, secondOrigin, viewer] = scenario.players
    if (!firstOrigin || !secondOrigin || !viewer) throw new Error('场景缺少玩家')

    // 当前链（第 1 条）的发起人直接离房（含房主迁移）：轮播不为他停下
    scenario.harness.service.leaveRoom(firstOrigin.playerId)
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 1, page: 'replay' })

    const pages = scenario.finishShowcaseChain()

    expect(pages).toHaveLength(6)
    expect(scenario.room.phase).toBe('relay_vote')
    // 下一棒玩家在展示期主动退出本局：链位保留、轮播继续（S37）
    scenario.harness.service.leaveGame(secondOrigin.playerId)
    scenario.harness.service.relay.beginShowcaseForChain(scenario.room, 2)

    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 2, half: 1, page: 'replay' })
    const showcase = showcaseOf(scenario, viewer.playerId)
    expect(showcase?.prompt.text).toBe(content.promptOf(1))
    expect(showcase?.prompt.player.id).toBe(secondOrigin.playerId)
    expect(scenario.finishShowcaseChain()).toHaveLength(6)
    expect(scenario.room.phase).toBe('relay_vote')
  })

  it('掉线成员身份被回收不中止轮播：本局照常走完并落盘（S7 / S12）', () => {
    const { scenario } = playToShowcaseWithSentinels()
    const dropped = scenario.players[1]
    if (!dropped) throw new Error('场景缺少玩家')

    // 第 2 条链的发起人掉线：轮播不为他停下，第 1 条链走完照常进入投票（S12）
    scenario.disconnect(dropped)
    scenario.finishShowcaseChain()
    expect(scenario.room.phase).toBe('relay_vote')

    // 推进到超过重连宽限：身份被回收（不在玩家册，展示他的链时 chip 走中性占位身份兜底），
    // 本局不因成员离场而中止——按服务端计时走完全部链与投票并落盘（S7）
    scenario.harness.runtime.advance(APP_CONFIG.network.reconnectGraceMs)
    expect(scenario.harness.service.players.has(dropped.playerId)).toBe(false)
    const games = scenario.harness.repositories.archive.games
    expect(games).toHaveLength(1)
    expect(games[0]?.archive.mode).toBe('relay')
    expect(games[0]?.archive.reason).toBe(serverStrings.notices.relayFinished)
    // 未投票的链一律按不赞同结算：全员 0 分（无弃权，S14）
    for (const result of games[0]?.results ?? []) expect(result.score).toBe(0)
  })

  it('关键节点通知：复盘开始播一次、每条链展示开始与投票开始各播一次，页推进一条都不播（S65）', () => {
    const { scenario } = playToShowcaseWithSentinels()
    const chainCount = scenario.players.length

    expect(scenario.notices()).toContain(serverStrings.notices.relayShowcaseStarted)
    expect(scenario.notices()).toContain(
      serverStrings.notices.relayChainShowcaseStarted(1, chainCount),
    )
    // 页推进（重播 → 停顿 → 揭晓）不播任何通知：整条链走完只多出「投票开始」这一条关键节点（S65）
    const noticesBefore = scenario.notices().length
    scenario.finishShowcaseChain()
    const added = scenario.notices().slice(noticesBefore)
    expect(added).toEqual([serverStrings.notices.relayVoteStarted])
    expect(
      scenario.notices().filter((text) => text === serverStrings.notices.relayVoteStarted),
    ).toHaveLength(1)

    // 切到下一条链才再播「第 k / N 条链开始展示」，而「复盘开始」全程只有一次
    scenario.harness.service.relay.beginShowcaseForChain(scenario.room, 2)
    const notices = scenario.notices()
    expect(notices).toContain(serverStrings.notices.relayChainShowcaseStarted(2, chainCount))
    expect(
      notices.filter((text) => text === serverStrings.notices.relayShowcaseStarted),
    ).toHaveLength(1)
    expect(
      notices.filter(
        (text) => text === serverStrings.notices.relayChainShowcaseStarted(1, chainCount),
      ),
    ).toHaveLength(1)
    // 一条链的投票通知只播一次（投票期不因收票重复播）
    expect(notices.filter((text) => text === serverStrings.notices.relayVoteStarted)).toHaveLength(
      1,
    )
  })
})
