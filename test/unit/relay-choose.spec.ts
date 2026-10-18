/**
 * 接龙步 1 选词（S12 / S31 / S35 / S40 / S50 / S53）。
 *
 * 断言口径（只用外部可观察行为）：
 * - 全员选完**秒切**作画：阶段与步号、步 id（选词与作画同一步，S53）、提交集与阶段时间；
 * - 候选按链隔离：每人的快照里绝不出现别人的候选词（S31 / S35）；
 * - 换一批按链独立：某链换批不改变其它链的候选，重复换批 / 关闭该功能时以既有错误码拒绝；
 * - 自定义题目复用经典事件，开启后直接成为本链题面；
 * - 选词超时由服务端**随机代选**：到点后每条链都有题面（绝不出现空白画布，S40）；
 * - 非法步骤 id / 非选词阶段 / 重复提交分别以 STALE_DRAW_EVENT / INVALID_PHASE / ALREADY_SUBMITTED 拒绝。
 */
import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '@draw-guess/shared'
import {
  errorCodeOf,
  startRelayGame,
  type RelayGameScenario,
} from './helpers/relay-game-fixture.ts'

/** 某玩家当前快照里被序列化后的整包内容：隐私断言用（越权内容一旦混入即现形）。 */
function serializedSnapshotOf(scenario: RelayGameScenario, playerId: string): string {
  return JSON.stringify(scenario.snapshotOf(playerId))
}

describe('接龙步 1 选词', () => {
  it('全员选完立即秒切作画：同一步 id、提交集清场、阶段时间按作画时长重算', () => {
    const scenario = startRelayGame()
    const stepIdBefore = scenario.stepId

    scenario.chooseAll()

    expect(scenario.room.phase).toBe('relay_draw')
    expect(scenario.relay.currentStep).toBe(1)
    // 选词与作画属于同一步（S53）：步 id 在切阶段时不变
    expect(scenario.relay.stepId).toBe(stepIdBefore)
    // 进入作画后本棒提交集清场：提交只统计作画完成（S64）
    expect([...scenario.relay.stepSubmissions]).toEqual([])
    const view = scenario.snapshotOf(scenario.host.playerId).relay
    expect(view?.currentStep).toBe(1)
    expect(view?.submitted).toBe(false)
    expect(view?.ownCanvas).toBeDefined()
    expect(scenario.relay.phaseEndsAt - scenario.relay.phaseStartedAt).toBe(
      scenario.room.settings.relayDrawSeconds * 1_000,
    )
  })

  it('选词期间每人只见自己那条链的候选：别人的候选词一个都不出现', () => {
    const scenario = startRelayGame()
    const chosen = scenario.players[0]
    if (!chosen) throw new Error('场景缺少玩家')

    const ownChain = scenario.chainOf(chosen.playerId, 1)
    const ownIds = ownChain.candidates.map((word) => word.id)
    const ownTexts = ownChain.candidates.map((word) => word.text)
    // 只挑「本链没有、别的链有」的词：链间本就可以撞词（不跨链去重，S31），
    // 因此隐私断言必须排除「别人也有但我也有的词」，才能证明是泄漏而不是撞词。
    const foreignTexts = scenario.relay.chains
      .filter((chain) => chain.originPlayerId !== chosen.playerId)
      .flatMap((chain) => chain.candidates.map((word) => word.text))
      .filter((text) => !ownTexts.includes(text))
    expect(foreignTexts.length, '词池足够大，必须存在只属于他人的候选词').toBeGreaterThan(0)

    const view = scenario.snapshotOf(chosen.playerId).relay
    expect(view?.wordOptions?.map((word) => word.id)).toEqual(ownIds)
    const serialized = serializedSnapshotOf(scenario, chosen.playerId)
    for (const text of foreignTexts)
      expect(serialized, `泄漏他人候选词 ${text}`).not.toContain(text)
  })

  it('换一批按链独立：本链候选换新、其它链原封不动；重复换批被拒', () => {
    const scenario = startRelayGame()
    const first = scenario.players[0]
    const second = scenario.players[1]
    if (!first || !second) throw new Error('场景缺少玩家')

    const mineBefore = scenario.chainOf(first.playerId, 1).candidates.map((word) => word.id)
    const othersBefore = scenario.relay.chains.slice(1).map((chain) => ({
      origin: chain.originPlayerId,
      ids: chain.candidates.map((word) => word.id),
    }))

    scenario.harness.backend.gameplay.rerollWordOptions(first.playerId, scenario.stepId)

    const mineAfter = scenario.chainOf(first.playerId, 1).candidates.map((word) => word.id)
    // 换批排除本链已展示过的词（S31 的按链去重口径）：抽到的新候选必然与旧的不同
    expect(mineAfter).not.toEqual(mineBefore)
    expect(mineAfter.some((id) => mineBefore.includes(id))).toBe(false)
    expect(scenario.chainOf(first.playerId, 1).rerollUsed).toBe(true)
    // 其它链的候选不受影响（候选按链隔离）
    for (const before of othersBefore) {
      const chain = scenario.relay.chains.find((item) => item.originPlayerId === before.origin)
      expect(chain?.candidates.map((word) => word.id)).toEqual(before.ids)
    }
    expect(
      errorCodeOf(() =>
        scenario.harness.backend.gameplay.rerollWordOptions(first.playerId, scenario.stepId),
      ),
    ).toBe(ERROR_CODES.REROLL_ALREADY_USED)
  })

  it('候选不跨链去重：同一词条可以同时是两条链的候选', () => {
    const scenario = startRelayGame()
    const first = scenario.players[0]
    const second = scenario.players[1]
    if (!first || !second) throw new Error('场景缺少玩家')
    const shared = scenario.chainOf(first.playerId, 1).candidates[0]
    if (!shared) throw new Error('链候选为空')
    // 把房间词池收到只剩一条词：第二条链换批时仍能抽到第一条链已有的同一个词（S31 不去重）
    scenario.room.selectedWordIds = new Set([shared.id])

    scenario.harness.backend.gameplay.rerollWordOptions(second.playerId, scenario.stepId)

    expect(
      scenario.chainOf(second.playerId, 1).candidates.every((word) => word.id === shared.id),
    ).toBe(true)
    expect(scenario.chainOf(first.playerId, 1).candidates.map((word) => word.id)).toContain(
      shared.id,
    )
  })

  it('换一批与自定义题目按房间规则开关拒绝', () => {
    const scenario = startRelayGame({
      settings: { allowWordReroll: false, allowCustomWord: false },
    })
    const player = scenario.players[0]
    if (!player) throw new Error('场景缺少玩家')

    expect(
      errorCodeOf(() =>
        scenario.harness.backend.gameplay.rerollWordOptions(player.playerId, scenario.stepId),
      ),
    ).toBe(ERROR_CODES.REROLL_DISABLED)
    expect(
      errorCodeOf(() =>
        scenario.harness.backend.gameplay.chooseCustomWord(
          player.playerId,
          scenario.stepId,
          '自定义题',
        ),
      ),
    ).toBe(ERROR_CODES.FORBIDDEN)
  })

  it('自定义题目开启后直接成为本链题面，并计入已提交', () => {
    const scenario = startRelayGame({ settings: { allowCustomWord: true } })
    const player = scenario.players[0]
    if (!player) throw new Error('场景缺少玩家')

    scenario.harness.backend.gameplay.chooseCustomWord(
      player.playerId,
      scenario.stepId,
      '自定义狐狸',
    )

    expect(scenario.chainOf(player.playerId, 1).step1Word?.text).toBe('自定义狐狸')
    expect(scenario.relay.stepSubmissions.has(player.playerId)).toBe(true)
    // 其余人未选完：仍在选词阶段等他们（S40 的全员选完秒切）
    expect(scenario.room.phase).toBe('relay_choose')
  })

  it('选词超时随机代选：到点后每条链都有题面（不出现空白画布）', () => {
    const scenario = startRelayGame()
    const chosen = scenario.players[0]
    if (!chosen) throw new Error('场景缺少玩家')
    const ownWord = scenario.chainOf(chosen.playerId, 1).candidates[0]
    if (!ownWord) throw new Error('链候选为空')
    scenario.harness.backend.gameplay.chooseWord(chosen.playerId, scenario.stepId, ownWord.id)
    // 记录未选者各自候选，用于断言代选来自「自己的候选」
    const pendingBefore = scenario.relay.chains
      .filter((chain) => !chain.step1Word)
      .map((chain) => ({ origin: chain.originPlayerId, ids: chain.candidates.map((w) => w.id) }))
    expect(pendingBefore).toHaveLength(scenario.players.length - 1)

    scenario.harness.runtime.advance(scenario.room.settings.relayChooseSeconds * 1_000)

    expect(scenario.room.phase).toBe('relay_draw')
    for (const pending of pendingBefore) {
      const chain = scenario.relay.chains.find((item) => item.originPlayerId === pending.origin)
      const word = chain?.step1Word
      expect(word, '超时者必须被代选，绝不留下空白画布').toBeDefined()
      expect(pending.ids).toContain(word?.id)
    }
    // 已经手动选过的人保持自己的选择
    expect(scenario.chainOf(chosen.playerId, 1).step1Word?.id).toBe(ownWord.id)
    // 每人的快照题面都等于自己那条链的词（非空）
    scenario.players.forEach((player) => {
      const chain = scenario.chainOf(player.playerId, 1)
      expect(scenario.snapshotOf(player.playerId).relay?.prompt).toBe(chain.step1Word?.text)
    })
  })

  it('非法步骤 id / 非选词阶段 / 重复提交分别按既有错误码拒绝', () => {
    const scenario = startRelayGame({ settings: { allowCustomWord: true } })
    const player = scenario.players[0]
    if (!player) throw new Error('场景缺少玩家')
    const word = scenario.chainOf(player.playerId, 1).candidates[0]
    if (!word) throw new Error('链候选为空')

    // 旧包（步骤 id 不符）：客户端据此重新同步步骤与候选
    expect(
      errorCodeOf(() =>
        scenario.harness.backend.gameplay.chooseWord(
          player.playerId,
          '00000000-0000-4000-8000-0000000000d1',
          word.id,
        ),
      ),
    ).toBe(ERROR_CODES.STALE_DRAW_EVENT)

    scenario.harness.backend.gameplay.chooseWord(player.playerId, scenario.stepId, word.id)
    expect(
      errorCodeOf(() =>
        scenario.harness.backend.gameplay.chooseWord(player.playerId, scenario.stepId, word.id),
      ),
    ).toBe(ERROR_CODES.ALREADY_SUBMITTED)
    expect(
      errorCodeOf(() =>
        scenario.harness.backend.gameplay.rerollWordOptions(player.playerId, scenario.stepId),
      ),
    ).toBe(ERROR_CODES.ALREADY_SUBMITTED)

    // 进入作画阶段后不再是选词棒
    scenario.chooseAll()
    expect(scenario.room.phase).toBe('relay_draw')
    expect(
      errorCodeOf(() =>
        scenario.harness.backend.gameplay.chooseWord(player.playerId, scenario.stepId, word.id),
      ),
    ).toBe(ERROR_CODES.INVALID_PHASE)
  })
})
