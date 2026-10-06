import { nextTick } from 'vue'
import { setActivePinia, type Pinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, EVENTS, RELAY_STEP_COUNT, type RelayShowcase } from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import HudPill from '@/components/game/HudPill.vue'
import PhaseOverlay from '@/components/game/PhaseOverlay.vue'
import RelayPlayerChip from '@/components/game/RelayPlayerChip.vue'
import RelayTopBarCenter from '@/components/game/relay/RelayTopBarCenter.vue'
import RelayTopBarLeading from '@/components/game/relay/RelayTopBarLeading.vue'
import RelayVoteOverlay from '@/components/game/relay/RelayVoteOverlay.vue'
import { useRoomStore } from '@/stores/room'
import {
  GUEST_ID,
  HOST_ID,
  createRelayRoomFixture,
  createRoomFixture,
} from '../client/room-fixture'
import { createPiniaWithFakeTransport, type FakeGameTransport } from '../client/fake-game-transport'

/**
 * 复盘展示与投票卡（工单 11 / §八）的组件级保障：
 * - 顶栏两种形态（动手期单答案 / 复盘期四元组）与 chip 角标语义；
 * - 未揭晓答案＝经典遮罩同款下划线占位（不是问号），位数取配置的固定值（S81）；
 * - 半场切换时「chip 原地不动、只有两个答案 UI 动」与过渡时长取自配置包（S70 / S76）；
 * - 链条进度紧跟最左标签之后（S75）；
 * - 投票卡两个答案底色一致、匿名票行无底色且按到达顺序（S42 / S82），ack 成功后才锁定并走 façade；
 * - 开局倒计时（还没有接龙视图）时顶栏按房间阶段渲染（不回落经典 ROUND 胶囊）；
 * - 接龙终局复用经典版式但第二行换接龙口径统计、不显示称号（S33 / S77）。
 */

let pinia: Pinia
let fakeTransport: FakeGameTransport

beforeEach(() => {
  const installed = createPiniaWithFakeTransport()
  pinia = installed.pinia
  fakeTransport = installed.fakeTransport
  setActivePinia(pinia)
  fakeTransport.setConnected(true)
})

afterEach(() => {
  vi.useRealTimers()
})

/** 挂载单个组件（真实 Pinia + 假传输），返回包装器由用例断言并卸载。 */
function mountWithPinia(
  component: Parameters<typeof mount>[0],
  props: Record<string, unknown> = {},
): VueWrapper {
  return mount(component, { props, global: { plugins: [pinia] } })
}

const THIRD_ID = '00000000-0000-4000-8000-000000000021'
const FOURTH_ID = '00000000-0000-4000-8000-000000000022'

/** 半场 1：链发起人（画家，带角标）→ 第二人（猜词者，不带角标）。 */
function halfOneShowcase(patch: Partial<RelayShowcase> = {}): RelayShowcase {
  return {
    chainIndex: 1,
    chainCount: 4,
    half: 1,
    prompt: { player: { id: HOST_ID, nickname: '发起人', avatarId: '01' }, text: '气球' },
    answer: { player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' }, text: null },
    drawing: { strokes: [], undoneStrokeIds: [], lastSequence: -1, drawingRevision: 0 },
    ...patch,
  }
}

/** 半场 2：第三人（画家，带角标）→ 第四人（猜词者，不带角标）。 */
function halfTwoShowcase(patch: Partial<RelayShowcase> = {}): RelayShowcase {
  return {
    chainIndex: 1,
    chainCount: 4,
    half: 2,
    prompt: { player: { id: THIRD_ID, nickname: '第三人', avatarId: '03' }, text: '长颈鹿' },
    answer: { player: { id: FOURTH_ID, nickname: '第四人', avatarId: '04' }, text: null },
    drawing: { strokes: [], undoneStrokeIds: [], lastSequence: -1, drawingRevision: 0 },
    ...patch,
  }
}

/** 动手期形态的必备 props（复盘形态下被忽略，故用例统一传一份）。 */
const PLAY_PROPS = {
  prompt: '气球',
  promptKind: 'text' as const,
  artistPaints: false,
}

/**
 * 接龙开局倒计时夹具：接龙房已进 `starting`，但该期服务端不下发 relay 视图（接龙阶段白名单，S22）。
 */
function useRelayStartingRoom(): void {
  const snapshot = createRelayRoomFixture()
  snapshot.phase = 'starting'
  delete snapshot.relay
  useRoomStore().room = snapshot
}

describe('RelayTopBarCenter 复盘形态', () => {
  it('四元组按快照渲染：画家 chip 带角标、猜词者 chip 不带、答案 A 与占位答案 B 就位', () => {
    const wrapper = mountWithPinia(RelayTopBarCenter, {
      ...PLAY_PROPS,
      showcase: halfOneShowcase(),
    })

    const chips = wrapper.findAllComponents(RelayPlayerChip)
    expect(chips).toHaveLength(2)
    expect(chips[0]!.text()).toContain('发起人')
    // 角标语义（S73）：画家这一段动了笔 → 带角标；猜词者只给了一句词 → 不带
    expect(chips[0]!.props('brushBadge')).toBe(true)
    expect(chips[1]!.text()).toContain('猜词者')
    expect(chips[1]!.props('brushBadge')).toBe(false)
    expect(wrapper.text()).toContain('气球')

    wrapper.unmount()
  })

  it('未揭晓的答案用经典遮罩同款下划线占位（不是问号），位数取配置的固定值（S81）', () => {
    const wrapper = mountWithPinia(RelayTopBarCenter, {
      ...PLAY_PROPS,
      showcase: halfOneShowcase(),
    })

    expect(wrapper.text()).toContain('＿'.repeat(APP_CONFIG.relay.hiddenAnswerChars))
    expect(wrapper.text()).not.toContain('?')
    expect(wrapper.text()).not.toContain('？')

    wrapper.unmount()
  })

  it('发布揭晓页快照后，右答案由占位换成服务端下发的文本', async () => {
    const wrapper = mountWithPinia(RelayTopBarCenter, {
      ...PLAY_PROPS,
      showcase: halfOneShowcase(),
    })
    expect(wrapper.text()).not.toContain('长颈鹿')

    await wrapper.setProps({
      showcase: halfOneShowcase({
        answer: { player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' }, text: '长颈鹿' },
      }),
    })

    expect(wrapper.text()).toContain('长颈鹿')
    expect(wrapper.text()).not.toContain('＿')
    wrapper.unmount()
  })

  it('半场切换：两个 chip 元素原地复用（位置固定），旧答案渐隐层按配置时长回收（S76）', async () => {
    vi.useFakeTimers()
    const wrapper = mountWithPinia(RelayTopBarCenter, {
      ...PLAY_PROPS,
      showcase: halfOneShowcase(),
    })
    const chipsBefore = wrapper.findAllComponents(RelayPlayerChip)
    const leftChipElement = chipsBefore[0]!.element
    const rightChipElement = chipsBefore[1]!.element

    // 过渡时长来自公开配置包（禁止魔法数字，S70）
    const answerPills = wrapper.findAllComponents(HudPill)
    expect(answerPills.length).toBeGreaterThanOrEqual(2)
    for (const pill of answerPills)
      expect((pill.element as HTMLElement).style.transitionDuration).toBe(
        `${APP_CONFIG.relay.capsuleTransitionMs}ms`,
      )

    await wrapper.setProps({ showcase: halfTwoShowcase() })
    await flushPromises()

    // chip 是同一批 DOM 元素：位置不动，只有内容就地换成第三人 / 第四人（S76）
    const chipsAfter = wrapper.findAllComponents(RelayPlayerChip)
    expect(chipsAfter[0]!.element).toBe(leftChipElement)
    expect(chipsAfter[1]!.element).toBe(rightChipElement)
    expect(chipsAfter[0]!.text()).toContain('第三人')
    expect(chipsAfter[1]!.text()).toContain('第四人')
    // 新左答案＝半场 2 的题面；旧左答案（气球）作为渐隐层仍在，直到配置时长结束才被回收
    expect(wrapper.text()).toContain('长颈鹿')
    expect(wrapper.text()).toContain('气球')

    vi.advanceTimersByTime(APP_CONFIG.relay.capsuleTransitionMs)
    await nextTick()
    expect(wrapper.text()).not.toContain('气球')

    wrapper.unmount()
  })

  it('不传 showcase 时仍是动手期的单答案形态', () => {
    const wrapper = mountWithPinia(RelayTopBarCenter, PLAY_PROPS)

    expect(wrapper.findAllComponents(RelayPlayerChip)).toHaveLength(0)
    expect(wrapper.text()).toContain('气球')
    wrapper.unmount()
  })

  it('上家未作答在动手期与复盘期以灰色文字配问号图标弱化展示（Image 4）', () => {
    // 动手期：prompt 为上家未作答
    const playWrapper = mountWithPinia(RelayTopBarCenter, {
      prompt: strings.ui.game.relayUnanswered,
      promptKind: 'text',
      artistPaints: false,
    })
    expect(playWrapper.text()).toContain(strings.ui.game.relayUnanswered)
    const promptEl = playWrapper.find('b')
    expect(promptEl.classes()).toContain('text-muted')
    expect(promptEl.classes()).not.toContain('text-yellow')
    expect(playWrapper.find('svg').exists()).toBe(true)
    playWrapper.unmount()

    // 复盘期：题面与揭晓答案均为上家未作答
    const showcaseWrapper = mountWithPinia(RelayTopBarCenter, {
      ...PLAY_PROPS,
      showcase: halfOneShowcase({
        prompt: {
          player: { id: HOST_ID, nickname: '发起人', avatarId: '01' },
          text: strings.ui.game.relayUnanswered,
        },
        answer: {
          player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' },
          text: strings.ui.game.relayUnanswered,
        },
      }),
    })
    expect(showcaseWrapper.text()).toContain(strings.ui.game.relayUnanswered)
    expect(showcaseWrapper.findAll('svg').length).toBeGreaterThanOrEqual(2)
    showcaseWrapper.unmount()
  })
})

describe('RelayTopBarLeading 链条进度', () => {
  it('复盘期把「第 k / N 条链」紧跟在最左标签之后，动手期不出现', () => {
    const showcaseLeading = mountWithPinia(RelayTopBarLeading, {
      phase: 'relay_showcase',
      step: 1,
      chainProgress: { index: 2, total: 4 },
    })
    expect(showcaseLeading.text()).toContain(strings.ui.game.relayChainProgress(2, 4))
    expect(showcaseLeading.text()).toContain(strings.ui.room.modeRelay)
    // 复盘期不再出棒次胶囊
    expect(showcaseLeading.text()).not.toContain(strings.ui.game.relayStepTotal(4))
    showcaseLeading.unmount()

    const playLeading = mountWithPinia(RelayTopBarLeading, { phase: 'relay_draw', step: 3 })
    expect(playLeading.text()).not.toContain(strings.ui.game.relayChainProgress(2, 4))
    expect(playLeading.text()).toContain(strings.ui.game.relayStepTotal(4))
    playLeading.unmount()
  })

  it('开局倒计时（还没有接龙视图）按房间阶段展示：不回落经典 ROUND 胶囊、不出现棒次胶囊', () => {
    useRelayStartingRoom()
    const wrapper = mountWithPinia(RelayTopBarLeading, { step: 0 })

    expect(wrapper.text()).toContain(strings.ui.room.modeRelay)
    expect(wrapper.text()).toContain(strings.ui.status.phaseStarting)
    expect(wrapper.text()).not.toContain(strings.ui.game.roundLabel)
    // 还没进接龙阶段，棒次无从谈起
    expect(wrapper.text()).not.toContain(strings.ui.game.relayStepTotal(RELAY_STEP_COUNT))
    wrapper.unmount()
  })
})

describe('RelayVoteOverlay 投票卡', () => {
  /** 投票期夹具：词 A → 词 B 都已揭晓，票行按到达顺序下发（agree、disagree、agree）。 */
  function mountVoteOverlay(
    relayPatch: Parameters<typeof createRelayRoomFixture>[1] = {},
  ): VueWrapper {
    useRoomStore().room = createRelayRoomFixture('relay_vote', {
      showcase: halfOneShowcase({
        answer: { player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' }, text: '长颈鹿' },
        votes: ['agree', 'disagree', 'agree'],
      }),
      ...relayPatch,
    })
    return mountWithPinia(RelayVoteOverlay)
  }

  it('两个答案底色一致，匿名票行按到达顺序且不带底色（S42 / S82）', () => {
    const wrapper = mountVoteOverlay()

    const answers = wrapper.findAll('span.inline-flex')
    expect(answers).toHaveLength(2)
    expect(answers[0]!.classes()).toContain('bg-yellow/25')
    // 底色不再一白一黄：两颗胶囊的类名完全一致（S82）
    expect(answers[0]!.classes()).toEqual(answers[1]!.classes())
    expect(wrapper.text()).toContain('气球')
    expect(wrapper.text()).toContain('长颈鹿')

    const votes = wrapper.findAll('[role="listitem"]')
    expect(votes).toHaveLength(3)
    for (const vote of votes) {
      // 票行只保留居中排列的票图标：任何底色类都不允许出现（S82）
      expect(vote.classes().join(' ')).not.toMatch(/\bbg-/)
    }
    // 到达顺序原样渲染：✔ 两张（绿）、✘ 一张（红）
    expect(votes[0]!.find('svg.text-success-fg').exists()).toBe(true)
    expect(votes[1]!.find('svg.text-red').exists()).toBe(true)
    expect(votes[2]!.find('svg.text-success-fg').exists()).toBe(true)

    wrapper.unmount()
  })

  it('不显示倒计时文案：剩余时间只看顶栏（S78）', () => {
    const wrapper = mountVoteOverlay()
    expect(wrapper.text()).not.toContain(strings.ui.game.secondsSuffix)
    wrapper.unmount()
  })

  it('ack 成功后才本地置灰，投票动作走 façade 的 relayVote（S13 / S14）', async () => {
    const wrapper = mountVoteOverlay()

    const agree = wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.game.relayVoteAgree))
    const disagree = wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.game.relayVoteDisagree))
    expect(agree).toBeDefined()
    expect(disagree).toBeDefined()
    expect(agree!.element.disabled).toBe(false)

    await agree!.trigger('click')
    await flushPromises()

    expect(fakeTransport.requests.at(-1)).toMatchObject({
      event: EVENTS.relayVote,
      payload: { choice: 'agree' },
    })
    // ack 成功后锁定：两个入口都置灰，不能再改票
    expect(agree!.element.disabled).toBe(true)
    expect(disagree!.element.disabled).toBe(true)

    wrapper.unmount()
  })

  it('投票失败（限频 / 阶段过期 / 断线）不本地锁死：保持可重试，重试成功后才锁定', async () => {
    fakeTransport.setResponder((_event, payload) => ({
      ok: false,
      requestId: String(payload.requestId),
      error: { code: ERROR_CODES.RATE_LIMITED, message: '请求过于频繁' },
    }))
    const wrapper = mountVoteOverlay()
    const agree = wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.game.relayVoteAgree))
    const disagree = wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.game.relayVoteDisagree))

    await agree!.trigger('click')
    await flushPromises()

    // 权威快照里我仍是「未投票」（左栏同口径），因此两个入口必须还能点，10 秒窗内可补救
    expect(useRoomStore().room?.relay?.submitted).toBe(false)
    expect(agree!.element.disabled).toBe(false)
    expect(disagree!.element.disabled).toBe(false)

    // 重试（换一票也行）ack 成功后，才由本地锁定收口
    fakeTransport.setResponder((_event, payload) => ({
      ok: true,
      requestId: String(payload.requestId),
      data: undefined,
    }))
    await disagree!.trigger('click')
    await flushPromises()

    expect(agree!.element.disabled).toBe(true)
    expect(disagree!.element.disabled).toBe(true)

    wrapper.unmount()
  })

  it('快照显示本人已投票时，入口一开始就置灰', () => {
    const wrapper = mountVoteOverlay({ submitted: true })
    for (const button of wrapper.findAll('button')) expect(button.element.disabled).toBe(true)
    wrapper.unmount()
  })

  it('投票卡中若最终答案为上家未作答，同样以灰色文字配问号图标展示（Image 4）', () => {
    const wrapper = mountVoteOverlay({
      showcase: halfOneShowcase({
        prompt: { player: { id: HOST_ID, nickname: '发起人', avatarId: '01' }, text: '气球' },
        answer: {
          player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' },
          text: strings.ui.game.relayUnanswered,
        },
      }),
    })

    expect(wrapper.text()).toContain(strings.ui.game.relayUnanswered)
    // 顶部问号图标 + 答案区域问号图标 svg
    expect(wrapper.findAll('svg').length).toBeGreaterThanOrEqual(2)
    wrapper.unmount()
  })
})

describe('PhaseOverlay 接龙终局', () => {
  it('复用经典结算版式：行内第二行换成接龙口径统计，且不出现荣誉称号（S33 / S77）', () => {
    useRoomStore().room = createRelayRoomFixture('game_result', {
      finalRanking: [
        {
          id: HOST_ID,
          nickname: '房主',
          avatarId: '01',
          rank: 1,
          score: 120,
          chainCount: 4,
          agreeVotes: 12,
        },
        {
          id: GUEST_ID,
          nickname: '猜词者',
          avatarId: '02',
          rank: 2,
          score: 80,
          chainCount: 4,
          agreeVotes: 8,
        },
      ],
    })
    const wrapper = mountWithPinia(PhaseOverlay, {
      secondsLeft: 12,
      game: undefined,
      rankings: [],
    })

    // 结算版式与经典共用：奖杯圆底 + GAME RESULT + 最终排行
    expect(wrapper.text()).toContain(strings.ui.game.gameResultLabel)
    expect(wrapper.text()).toContain(strings.ui.game.finalRanking)
    // 榜行来自接龙视图的 finalRanking（经典 rankings 为空也不影响），第二行是接龙口径统计
    expect(wrapper.text()).toContain('房主')
    expect(wrapper.text()).toContain(strings.ui.game.relayPlayerStats(4, 12))
    expect(wrapper.text()).toContain(strings.ui.game.relayPlayerStats(4, 8))
    // 不显示称号（接龙猜词不判对错，经典统计无数据源），也不显示经典口径统计
    for (const accolade of Object.values(strings.ui.game.accolades))
      expect(wrapper.text()).not.toContain(accolade)
    expect(wrapper.text()).not.toContain(strings.ui.game.playerStats(0, 0, 0))

    wrapper.unmount()
  })

  it('经典终局仍是称号 + 经典口径统计（接龙分流不影响经典）', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('game_result')
    const wrapper = mountWithPinia(PhaseOverlay, {
      secondsLeft: 12,
      game: roomStore.room.game,
      rankings: [
        {
          id: HOST_ID,
          nickname: '房主',
          avatarId: '01',
          rank: 1,
          score: 99,
          stats: { correctCount: 2, totalGuessMs: 4_000, drawingCorrectCount: 1 },
        },
      ],
    })

    expect(wrapper.text()).toContain(strings.ui.game.playerStats(2, 2, 1))
    expect(wrapper.text()).not.toContain(strings.ui.game.relayPlayerStats(0, 0))
    wrapper.unmount()
  })
})
