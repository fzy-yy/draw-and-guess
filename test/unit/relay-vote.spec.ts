/**
 * 接龙链投票（工单 08；S13 / S14 / S21 / S23 / S41 / S42 / S64 / S65）。
 *
 * 断言口径以外部可观察行为为主：快照载荷（匿名票行 / 已投票集合）、ack 错误码、系统通知、
 * 假时钟推进与结算后的分数；「行尾补不赞同」这类只有到点瞬间才存在的票行状态，
 * 由装配缝暴露的权威记录读取（与工单 07 读取链画布的写法一致）。
 * - 每条链展示完毕后进入 `relay.voteSeconds` 上限的投票窗口，游标保留在该链（投票卡要并排展示两个答案）；
 * - 只有赞同 / 不赞同两项、点下即锁定（重复投票被拒），票行**匿名 + 到达顺序**实时公开（S42）；
 * - 链阵容全员投完即把剩余时间压到收尾窗口（ADR-0063），剩余不足收尾窗口时原样不动；
 *   掉线 / 离局者不豁免，他们没投就照旧走满上限；
 * - 无弃权：倒计时到点仍未投的链阵容成员一律计不赞同（S14），离局 / 离房者同样按未投处理。
 */
import { describe, expect, it } from 'vitest'
import {
  CLIENT_REQUEST_SCHEMAS,
  ERROR_CODES,
  EVENTS,
  RelayVoteSchema,
  RoomSnapshotSchema,
} from '@draw-guess/shared'
import { serverStrings } from '@draw-guess/strings'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import {
  errorCodeOf,
  startRelayGame,
  type RelayGameScenario,
} from './helpers/relay-game-fixture.ts'

const REQUEST_ID = '00000000-0000-4000-8000-0000000000c8'

/** 观看者快照里的接龙视图（投票期断言的主体）。 */
function relayViewOf(scenario: RelayGameScenario, playerId: string) {
  const view = scenario.snapshotOf(playerId).relay
  if (!view) throw new Error('接龙房间缺少 relay 视图')
  return view
}

/** 走到第 1 条链的投票期（四步 → 复盘 6 页）。 */
function toVotePhase(): RelayGameScenario {
  const scenario = startRelayGame()
  scenario.playToShowcase()
  scenario.finishShowcaseChain()
  return scenario
}

describe('接龙链投票（工单 08）', () => {
  it('展示完毕切入投票：窗口＝relay.voteSeconds、游标保留、播「投票开始」关键节点（S21 / S23 / S65）', () => {
    const scenario = toVotePhase()

    expect(scenario.room.phase).toBe('relay_vote')
    // 投票窗口固定为配置时长（断言值与配置包同源，防止魔法数字漂移）
    const voteMs = APP_CONFIG.relay.voteSeconds * 1_000
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(voteMs)
    // 游标保留在该链的最后一个半场揭晓页：投票卡要并排展示两个答案（S78 / S23）
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 2, page: 'reveal' })
    // 关键节点通知（S65）：每条链的投票开始播一次
    expect(scenario.notices()).toContain(serverStrings.notices.relayVoteStarted)
    // 票行此刻为空数组（还没有人投票），全员都是「未投票」
    const view = relayViewOf(scenario, scenario.host.playerId)
    expect(view.showcase?.votes).toEqual([])
    expect(view.submittedPlayerIds).toEqual([])
  })

  it('投票期左胶囊＝该链**初始词**、右胶囊＝第四棒答案（S44 / ADR-0058）', () => {
    const scenario = toVotePhase()
    const chain = scenario.relay.chains[0]
    if (!chain) throw new Error('场景缺少链')
    if (!chain.step1Word) throw new Error('链缺少初始词')

    const view = relayViewOf(scenario, scenario.host.playerId)
    // 左：发起人选的初始词（不是切投票前那一刻半场 2 的 step2Guess）＋其作者 chip
    expect(view.showcase?.prompt.text).toBe(chain.step1Word.text)
    expect(view.showcase?.prompt.text).not.toBe(chain.step2Guess)
    expect(view.showcase?.prompt.player.id).toBe(chain.originPlayerId)
    // 右：最终答案（第四棒猜出的文本），投票期已揭晓
    expect(view.showcase?.answer.text).toBe(chain.step4Guess)
  })

  it('投票期断线不直接离房：宽限内重连可补投自己那一票（US48）', () => {
    const scenario = toVotePhase()
    const dropped = scenario.players[2]
    if (!dropped) throw new Error('场景缺少玩家')

    scenario.disconnect(dropped)
    // 保席：断线者没有被 leaveRoom 移出成员表，仍指向房间（开局后不可加入，S36）
    expect(scenario.room.members.some((member) => member.playerId === dropped.playerId)).toBe(true)
    expect(scenario.harness.service.players.get(dropped.playerId)?.roomId).toBe(scenario.room.id)

    // 宽限内重连：回到同一席位并投出自己的票（若已被移出房间，这里会以 NOT_IN_ROOM 失败）
    scenario.reconnect(dropped)
    scenario.vote(dropped, 'disagree')
    expect(relayViewOf(scenario, scenario.host.playerId).showcase?.votes).toEqual(['disagree'])
  })

  it('票行匿名且按到达顺序实时公开：只出现选择、不含投票者身份（S42）', () => {
    const scenario = toVotePhase()
    const [first, second, third] = scenario.players
    if (!first || !second || !third) throw new Error('场景缺少玩家')

    // 到达顺序：second 先投不赞同、first 后投赞同 → 行内顺序与到达顺序一致，与席位无关
    scenario.vote(second, 'disagree')
    scenario.vote(first, 'agree')

    for (const viewer of [first, second, third]) {
      const showcase = relayViewOf(scenario, viewer.playerId).showcase
      expect(showcase?.votes).toEqual(['disagree', 'agree'])
      // 匿名：票行单元是纯字符串（选择本身），不存在任何投票者字段
      for (const unit of showcase?.votes ?? []) expect(typeof unit).toBe('string')
    }
    // 整份快照里不存在「某个 playerId 与某个选择成对出现」的结构
    const serialized = JSON.stringify(scenario.snapshotOf(first.playerId))
    expect(serialized).not.toContain(`"playerId":"${first.playerId}","choice"`)
    expect(serialized).not.toContain(`"choice":"agree","playerId"`)
    // 快照照旧通过协议闸门（票行是合法的公开内容）
    expect(RoomSnapshotSchema.safeParse(scenario.snapshotOf(first.playerId)).success).toBe(true)
  })

  it('已投票集合按人下发：只给 id 列表，不含选择、也不含计数（S41 / S64）', () => {
    const scenario = toVotePhase()
    const [first, second, third] = scenario.players
    if (!first || !second || !third) throw new Error('场景缺少玩家')

    // 投票前：谁都没投，我自己的 submitted 也是 false
    expect(relayViewOf(scenario, first.playerId).submittedPlayerIds).toEqual([])
    expect(relayViewOf(scenario, first.playerId).submitted).toBe(false)

    scenario.vote(first, 'agree')

    // 自己视角：已投 → submitted 与该集合同时更新；他人视角看到同一份集合
    expect(relayViewOf(scenario, first.playerId).submitted).toBe(true)
    expect(relayViewOf(scenario, first.playerId).submittedPlayerIds).toEqual([first.playerId])
    expect(relayViewOf(scenario, third.playerId).submittedPlayerIds).toEqual([first.playerId])
    expect(relayViewOf(scenario, third.playerId).submitted).toBe(false)

    scenario.vote(second, 'disagree')

    // 集合里只有 id（无选择）：与票行合起来也无法还原「谁投了什么」
    expect(relayViewOf(scenario, third.playerId).submittedPlayerIds).toEqual([
      first.playerId,
      second.playerId,
    ])
  })

  it('点下即锁定：重复投票被拒（ALREADY_SUBMITTED），票行不增（S14）', () => {
    const scenario = toVotePhase()
    const voter = scenario.players[1]
    if (!voter) throw new Error('场景缺少玩家')

    scenario.vote(voter, 'agree')
    expect(errorCodeOf(() => scenario.vote(voter, 'disagree'))).toBe(ERROR_CODES.ALREADY_SUBMITTED)
    expect(errorCodeOf(() => scenario.vote(voter, 'agree'))).toBe(ERROR_CODES.ALREADY_SUBMITTED)
    // 锁定后票行仍然只有一票，且仍是第一次投的那张
    expect(relayViewOf(scenario, scenario.host.playerId).showcase?.votes).toEqual(['agree'])
  })

  it('全员投完即压缩窗口：剩余 > 收尾窗口时压到收尾窗口，到点进入下一条链（S21 修订 / ADR-0063）', () => {
    const scenario = toVotePhase()
    const voteStartedAt = scenario.relay.phaseStartedAt
    const graceMs = APP_CONFIG.relay.voteAllSubmittedSeconds * 1_000

    // 投了 2 秒才收齐：剩余 8 秒，远大于收尾窗口
    scenario.harness.runtime.advance(2_000)
    scenario.voteAll('agree')

    // 阶段未变，但窗口被重设：起点＝最后一票到达时刻，长度＝收尾窗口
    expect(scenario.room.phase).toBe('relay_vote')
    expect(scenario.relay.phaseStartedAt).toBe(voteStartedAt + 2_000)
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(graceMs)
    // 票行已收齐（无弃权补票，因为全员都已投）
    expect(relayViewOf(scenario, scenario.host.playerId).showcase?.votes).toHaveLength(
      scenario.players.length,
    )

    // 收尾窗口内仍是投票期，到点才结算并进入下一条链
    scenario.harness.runtime.advance(graceMs - 1)
    expect(scenario.room.phase).toBe('relay_vote')
    scenario.harness.runtime.advance(1)
    expect(scenario.room.phase).toBe('relay_showcase')
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 2, half: 1, page: 'replay' })
    // 判定口径不变：全员赞同 → 本链匹配通过、参与者入账
    expect(scenario.relay.chains[0]?.result?.matched).toBe(true)
  })

  it('全员投完但剩余已不足收尾窗口：窗口原样不动，不延长也不缩短（ADR-0063）', () => {
    const scenario = toVotePhase()
    const startedAt = scenario.relay.phaseStartedAt
    const endsAt = scenario.relay.phaseEndsAt
    const voteMs = APP_CONFIG.relay.voteSeconds * 1_000

    // 拖到只剩 2 秒才收齐
    scenario.harness.runtime.advance(voteMs - 2_000)
    scenario.voteAll('agree')

    expect(scenario.room.phase).toBe('relay_vote')
    expect(scenario.relay.phaseStartedAt).toBe(startedAt)
    expect(scenario.relay.phaseEndsAt).toBe(endsAt)

    // 按原窗口到点结算
    scenario.harness.runtime.advance(2_000)
    expect(scenario.room.phase).toBe('relay_showcase')
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 2, half: 1, page: 'replay' })
  })

  it('只有部分人投票：窗口保持上限，到点才结算（ADR-0063）', () => {
    const scenario = toVotePhase()
    const startedAt = scenario.relay.phaseStartedAt
    const endsAt = scenario.relay.phaseEndsAt
    const voteMs = APP_CONFIG.relay.voteSeconds * 1_000
    const [first, second] = scenario.players
    if (!first || !second) throw new Error('场景缺少玩家')

    scenario.vote(first, 'agree')
    scenario.vote(second, 'disagree')

    // 未收齐：窗口不动
    expect(scenario.relay.phaseStartedAt).toBe(startedAt)
    expect(scenario.relay.phaseEndsAt).toBe(endsAt)

    scenario.harness.runtime.advance(voteMs - 1)
    expect(scenario.room.phase).toBe('relay_vote')
    scenario.harness.runtime.advance(1)
    expect(scenario.room.phase).toBe('relay_showcase')
  })

  it('掉线者未投不加速：窗口走满上限，到点按未投补不赞同（ADR-0063）', () => {
    const scenario = toVotePhase()
    const startedAt = scenario.relay.phaseStartedAt
    const endsAt = scenario.relay.phaseEndsAt
    const voteMs = APP_CONFIG.relay.voteSeconds * 1_000
    const dropped = scenario.players[2]
    if (!dropped) throw new Error('场景缺少玩家')

    scenario.disconnect(dropped)
    scenario.voteAll('agree')

    // 掉线者不豁免：链阵容没凑齐，窗口保持满上限
    expect(scenario.relay.phaseStartedAt).toBe(startedAt)
    expect(scenario.relay.phaseEndsAt).toBe(endsAt)

    scenario.harness.runtime.advance(voteMs)
    expect(scenario.room.phase).toBe('relay_showcase')
    // 未投的掉线者被补成不赞同（无弃权口径不变）
    expect(scenario.relay.chains[0]?.votes.map((vote) => vote.choice)).toEqual([
      'agree',
      'agree',
      'agree',
      'disagree',
    ])
  })

  it('最后一条链收齐同样压缩：收尾窗口结束即进终局（ADR-0063）', () => {
    const scenario = startRelayGame()
    scenario.playToShowcase()
    const graceMs = APP_CONFIG.relay.voteAllSubmittedSeconds * 1_000
    const chainCount = scenario.relay.chains.length

    // 前几条链照常结算
    for (let chainIndex = 1; chainIndex < chainCount; chainIndex += 1) {
      scenario.finishShowcaseChain()
      scenario.voteAll('agree')
      scenario.advanceVoteWindow()
    }

    // 最后一条链：收齐后窗口压缩，收尾窗口结束进终局
    scenario.finishShowcaseChain()
    expect(scenario.room.phase).toBe('relay_vote')
    scenario.voteAll('agree')
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(graceMs)
    scenario.harness.runtime.advance(graceMs)
    expect(scenario.room.phase).toBe('game_result')
  })

  it('无弃权：未投者计不赞同，够翻转阈值（2 赞同 vs 2 未投 → 本链 0 分）（S13 / S14）', () => {
    const scenario = startRelayGame()
    scenario.playToShowcase()
    const [first, second] = scenario.players
    if (!first || !second) throw new Error('场景缺少玩家')

    scenario.finishShowcaseChain()
    // 只有一半人投赞同：若未投者被当成弃权（不计票），2:0 会判匹配成功；计不赞同则 2:2 平票
    scenario.vote(first, 'agree')
    scenario.vote(second, 'agree')
    scenario.advanceVoteWindow()

    expect(scenario.room.phase).toBe('relay_showcase')
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 2, half: 1, page: 'replay' })
    for (const member of scenario.room.members) expect(member.score).toBe(0)
    // 行尾补的两张不赞同：票行单元仍只有选择、没有归属
    expect(scenario.relay.chains[0]?.votes.map((vote) => vote.choice)).toEqual([
      'agree',
      'agree',
      'disagree',
      'disagree',
    ])
  })

  it('离局 / 离房者按未投处理：只剩两人投赞同也判 2:2 平票（S14 / S37）', () => {
    const scenario = startRelayGame()
    scenario.playToShowcase()
    const [first, , third, fourth] = scenario.players
    if (!first || !third || !fourth) throw new Error('场景缺少玩家')

    scenario.finishShowcaseChain()
    // 第二名玩家主动退出本局（保留成绩卡与链位）、第三名直接离房：两者都不能再投票
    const second = scenario.players[1]
    if (!second) throw new Error('场景缺少玩家')
    scenario.harness.service.leaveGame(second.playerId)
    scenario.harness.service.leaveRoom(third.playerId)

    scenario.vote(first, 'agree')
    scenario.vote(fourth, 'agree')

    const view = relayViewOf(scenario, first.playerId)
    // 已投票集合只含真正投票的两人（离局 / 离房者仍是未投）
    expect(view.submittedPlayerIds).toEqual([first.playerId, fourth.playerId])
    expect(view.showcase?.votes).toEqual(['agree', 'agree'])

    scenario.advanceVoteWindow()

    // 未投的两人按不赞同计入 → 平票 → 本链 0 分，轮播照常继续（S7 / S12）
    expect(scenario.relay.chains[0]?.votes.map((vote) => vote.choice)).toEqual([
      'agree',
      'agree',
      'disagree',
      'disagree',
    ])
    expect(scenario.room.phase).toBe('relay_showcase')
    for (const member of scenario.room.members) expect(member.score).toBe(0)
  })

  it('阶段守卫：非投票期的投票一律被拒，且不动现场（S14 / S21）', () => {
    const scenario = startRelayGame()
    const voter = scenario.host

    // 对局期（步 1 选词）
    expect(errorCodeOf(() => scenario.vote(voter, 'agree'))).toBe(ERROR_CODES.INVALID_PHASE)

    // 展示期：进入复盘轮播后同样拒绝
    scenario.playToShowcase()
    expect(errorCodeOf(() => scenario.vote(voter, 'agree'))).toBe(ERROR_CODES.INVALID_PHASE)
    expect(scenario.room.phase).toBe('relay_showcase')
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 1, half: 1, page: 'replay' })

    // 终局：全部链投票结束后仍拒绝
    for (let chainIndex = 1; chainIndex <= scenario.relay.chains.length; chainIndex += 1) {
      scenario.finishChainVote('agree')
    }
    expect(scenario.room.phase).toBe('game_result')
    expect(errorCodeOf(() => scenario.vote(voter, 'agree'))).toBe(ERROR_CODES.INVALID_PHASE)
  })

  it('协议边界：只有赞同 / 不赞同被受理，多传字段与非法 choice 都被 strict 拒绝（S13）', () => {
    const schema = CLIENT_REQUEST_SCHEMAS[EVENTS.relayVote]
    expect(schema).toBe(RelayVoteSchema)
    expect(schema.safeParse({ requestId: REQUEST_ID, choice: 'agree' }).success).toBe(true)
    expect(schema.safeParse({ requestId: REQUEST_ID, choice: 'disagree' }).success).toBe(true)
    expect(schema.safeParse({ requestId: REQUEST_ID, choice: 'abstain' }).success).toBe(false)
    expect(
      schema.safeParse({ requestId: REQUEST_ID, choice: 'agree', stepId: REQUEST_ID }).success,
    ).toBe(false)
    expect(schema.safeParse({ requestId: REQUEST_ID }).success).toBe(false)
  })
})
