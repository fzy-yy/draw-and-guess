/**
 * 接龙链投票（工单 08；S13 / S14 / S21 / S23 / S41 / S42 / S64 / S65）。
 *
 * 断言口径以外部可观察行为为主：快照载荷（匿名票行 / 已投票集合）、ack 错误码、系统通知、
 * 假时钟推进与结算后的分数；「行尾补不赞同」这类只有到点瞬间才存在的票行状态，
 * 由装配缝暴露的权威记录读取（与工单 07 读取链画布的写法一致）。
 * - 每条链展示完毕后进入固定 `relay.voteSeconds` 的投票窗口（S21），游标保留在该链（投票卡要并排展示两个答案）；
 * - 只有赞同 / 不赞同两项、点下即锁定（重复投票被拒），票行**匿名 + 到达顺序**实时公开（S42）；
 * - 即使全员投完也一律等满倒计时（S21），从不提前公布；
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

  it('全员投完也不提前公布：仍等满固定倒计时，到点才结算（S21）', () => {
    const scenario = toVotePhase()
    const voteMs = APP_CONFIG.relay.voteSeconds * 1_000

    scenario.voteAll('agree')

    // 全员已投：票行已满，但阶段仍在投票期
    expect(scenario.room.phase).toBe('relay_vote')
    expect(relayViewOf(scenario, scenario.host.playerId).showcase?.votes).toHaveLength(
      scenario.players.length,
    )
    // 到点前 1ms 仍是投票期，完全没有提前公布
    scenario.harness.runtime.advance(voteMs - 1)
    expect(scenario.room.phase).toBe('relay_vote')
    // 到点才结算：本链匹配成功 → 进入下一条链的展示入口
    scenario.harness.runtime.advance(1)
    expect(scenario.room.phase).toBe('relay_showcase')
    expect(scenario.showcaseCursor()).toEqual({ chainIndex: 2, half: 1, page: 'replay' })
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
