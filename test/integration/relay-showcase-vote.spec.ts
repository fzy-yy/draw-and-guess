import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, type Pinia } from 'pinia'
import { EVENTS, type RelayShowcase, type Stroke } from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import GameView from '@/views/GameView.vue'
import GameCanvas from '@/components/game/GameCanvas.vue'
import RelayVoteOverlay from '@/components/game/relay/RelayVoteOverlay.vue'
import { DrawingReplayMachine } from '@/canvas/replay-machine'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { GUEST_ID, HOST_ID, createRelayRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport, type FakeGameTransport } from '../client/fake-game-transport'

/**
 * 复盘展示与投票卡在完整舞台骨架里的接线（S32 / S75 / S76 / S78）：
 * - 复盘画作随快照进入**同一条**画布渲染路径（同一个 `GameCanvas`），并按半场键区分会话；
 * - 每个半场开始时按配置时长触发一次只读重播（重播机器经原型 spy 观察，不另起渲染路径）；
 * - 顶栏四元组与链条进度、投票卡挂载位置（画布容器内）与点击投票的 façade 接线。
 */

/** 最小 Canvas 2D 上下文替身：记录绘制调用即可，重放决策由画布组件自身保障。 */
function createContextStub(): CanvasRenderingContext2D {
  return {
    canvas: { width: 1280, height: 720 },
    globalCompositeOperation: 'source-over',
    strokeStyle: '#000000',
    fillStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    imageSmoothingEnabled: true,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

let pinia: Pinia
let fakeTransport: FakeGameTransport

beforeEach(() => {
  // happy-dom 无 Canvas 2D 与布局：固定展示画布尺寸，保证逻辑栅格推导确定。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => createContextStub() as never,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 640,
    bottom: 360,
    width: 640,
    height: 360,
    toJSON: () => ({}),
  } as DOMRect)

  const installed = createPiniaWithFakeTransport()
  pinia = installed.pinia
  fakeTransport = installed.fakeTransport
  setActivePinia(pinia)
  fakeTransport.setConnected(true)
  useSessionStore().playerId = HOST_ID
})

afterEach(() => {
  fakeTransport.transport.destroy()
  vi.restoreAllMocks()
})

/** 挂载完整对局视图（真实子组件树），返回包装器由用例断言并卸载。 */
function mountGameView(): VueWrapper {
  return mount(GameView, { global: { plugins: [pinia] } })
}

/** 一份可断言的最小笔画（序号 0 起，与服务端的序号单调口径一致）。 */
function strokeFixture(id: string, sequence: number): Stroke {
  return {
    kind: 'stroke',
    id,
    tool: 'pen',
    color: '#1F2937',
    width: 5,
    points: [{ x: 0.2, y: 0.2 }],
    sequence,
    startPointIndex: 0,
  }
}

const SHOWCASE_STROKE = strokeFixture('00000000-0000-4000-8000-000000000031', 0)

/** 半场 1 的快照：画家＝链发起人（带角标）、猜词者＝第二人、答案未揭晓（S76）。 */
function halfOneShowcase(patch: Partial<RelayShowcase> = {}): RelayShowcase {
  return {
    chainIndex: 1,
    chainCount: 4,
    half: 1,
    prompt: { player: { id: HOST_ID, nickname: '发起人', avatarId: '01' }, text: '气球' },
    answer: { player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' }, text: null },
    drawing: {
      strokes: [SHOWCASE_STROKE],
      undoneStrokeIds: [],
      lastSequence: 0,
      drawingRevision: 1,
    },
    ...patch,
  }
}

describe('复盘展示期舞台接线', () => {
  it('顶栏四元组与链条进度就位，复盘画作走同一条画布渲染路径（只读、无工具条）', async () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_showcase', {
      currentStep: 4,
      showcase: halfOneShowcase(),
    })

    const wrapper = mountGameView()
    await flushPromises()

    // 顶栏左栏：模式 + 阶段 + 链条进度（紧跟最左标签之后）
    expect(wrapper.text()).toContain(strings.ui.room.modeRelay)
    expect(wrapper.text()).toContain(strings.ui.game.relayPhaseShowcase)
    expect(wrapper.text()).toContain(strings.ui.game.relayChainProgress(1, 4))
    // 顶栏正中：画家与猜词者 chip、答案 A 与未揭晓占位（经典遮罩同款下划线）
    expect(wrapper.text()).toContain('发起人')
    expect(wrapper.text()).toContain('猜词者')
    expect(wrapper.text()).toContain('气球')
    expect(wrapper.text()).toContain('＿'.repeat(APP_CONFIG.relay.hiddenAnswerChars))
    // 画布数据源＝当前半场的公开画作，会话键按「链序号 + 半场」区分
    const canvas = wrapper.findComponent(GameCanvas)
    expect(canvas.props('strokes')).toEqual([SHOWCASE_STROKE])
    expect(String(canvas.props('roundId'))).toContain('1-1')
    expect(canvas.props('canDraw')).toBe(false)
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(false)
    // 复盘期不表达提交 / 投票状态（进度归顶栏）
    expect(wrapper.text()).not.toContain(strings.ui.game.relayNotSubmitted)
    expect(wrapper.text()).not.toContain(strings.ui.game.relayNotVoted)

    wrapper.unmount()
  })

  it('揭晓页快照到达后右答案换成服务端下发的文本', async () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_showcase', {
      currentStep: 4,
      showcase: halfOneShowcase(),
    })
    const wrapper = mountGameView()
    await flushPromises()
    expect(wrapper.text()).not.toContain('长颈鹿')

    roomStore.room = createRelayRoomFixture('relay_showcase', {
      currentStep: 4,
      showcase: halfOneShowcase({
        answer: { player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' }, text: '长颈鹿' },
      }),
    })
    await flushPromises()

    expect(wrapper.text()).toContain('长颈鹿')
    expect(wrapper.text()).not.toContain('＿')
    wrapper.unmount()
  })

  it('每个半场开始时按配置时长只读重播一次（重播机器经原型 spy 观察）', async () => {
    const speedrun = vi
      .spyOn(DrawingReplayMachine.prototype, 'speedrun')
      .mockResolvedValue(undefined)
    const roomStore = useRoomStore()
    // 先停在动手期：复盘期的半场切换才应该触发重播
    roomStore.room = createRelayRoomFixture('relay_guess', {
      currentStep: 4,
      previousDrawing: {
        strokes: [SHOWCASE_STROKE],
        undoneStrokeIds: [],
        lastSequence: 0,
        drawingRevision: 1,
      },
    })
    const wrapper = mountGameView()
    await flushPromises()
    expect(speedrun).not.toHaveBeenCalled()

    roomStore.room = createRelayRoomFixture('relay_showcase', {
      currentStep: 4,
      showcase: halfOneShowcase(),
    })
    await nextTick()
    await flushPromises()
    expect(speedrun).toHaveBeenCalledTimes(1)
    expect(speedrun).toHaveBeenLastCalledWith(APP_CONFIG.relay.replaySeconds * 1_000)

    // 半场 2：画作换了一幅，会话键变化 → 再重播一次
    roomStore.room = createRelayRoomFixture('relay_showcase', {
      currentStep: 4,
      showcase: halfOneShowcase({
        half: 2,
        prompt: { player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' }, text: '长颈鹿' },
      }),
    })
    await nextTick()
    await flushPromises()
    expect(speedrun).toHaveBeenCalledTimes(2)
    expect(String(wrapper.findComponent(GameCanvas).props('roundId'))).toContain('1-2')

    wrapper.unmount()
  })
})

describe('投票期舞台接线', () => {
  it('投票卡挂在画布容器内，左栏显示已投 / 未投，点下即走 façade 的 relayVote', async () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_vote', {
      currentStep: 4,
      submittedPlayerIds: [GUEST_ID],
      showcase: halfOneShowcase({
        answer: { player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' }, text: '长颈鹿' },
        votes: ['agree'],
      }),
    })
    const wrapper = mountGameView()
    await flushPromises()

    const overlay = wrapper.findComponent(RelayVoteOverlay)
    expect(overlay.exists()).toBe(true)
    // 挂在 62cqw 中栏（画布容器）内，而不是整页遮罩
    const midColumn = wrapper
      .findAll('div')
      .find((column) => column.classes().includes('w-[62cqw]'))
    expect(midColumn).toBeDefined()
    expect(midColumn!.findComponent(RelayVoteOverlay).exists()).toBe(true)
    expect(overlay.text()).toContain(strings.ui.game.relayVoteTitle)

    // 左栏按快照渲染投票进度：本人已投、他人未投
    expect(wrapper.text()).toContain(strings.ui.game.relayVoted)
    expect(wrapper.text()).toContain(strings.ui.game.relayNotVoted)

    const agree = overlay
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.game.relayVoteAgree))
    expect(agree).toBeDefined()
    await agree!.trigger('click')
    await flushPromises()

    expect(fakeTransport.requests.at(-1)).toMatchObject({
      event: EVENTS.relayVote,
      payload: { choice: 'agree' },
    })
    expect(agree!.element.disabled).toBe(true)

    wrapper.unmount()
  })

  it('终局榜按接龙口径统计渲染，且不出现称号', async () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('game_result', {
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
      ],
    })
    const wrapper = mountGameView()
    await flushPromises()

    expect(wrapper.text()).toContain(strings.ui.game.finalRanking)
    expect(wrapper.text()).toContain(strings.ui.game.relayPlayerStats(4, 12))
    for (const accolade of Object.values(strings.ui.game.accolades))
      expect(wrapper.text()).not.toContain(accolade)

    wrapper.unmount()
  })

  it('展示期与终局不表达左栏角色状态，终局顶栏中央也不出现「等待选词…」占位（S41 / S33）', async () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_showcase', { showcase: halfOneShowcase() })
    const wrapper = mountGameView()
    await flushPromises()
    // 展示期不表达状态：既不显示接龙提交态，也**不**回落到经典角色文案（「猜词中」）
    expect(wrapper.text()).not.toContain(strings.ui.game.relayNotSubmitted)
    expect(wrapper.text()).not.toContain(strings.ui.status.roleGuessing)

    roomStore.room = createRelayRoomFixture('game_result')
    await flushPromises()
    // 终局同理，且顶栏中央不再回落到「等待选词…」（排名由结算卡表达）
    expect(wrapper.text()).not.toContain(strings.ui.status.roleGuessing)
    expect(
      wrapper.find(`header[aria-label="${strings.a11y.game.topBarAria}"]`).text(),
    ).not.toContain(strings.ui.game.awaitingWord)

    wrapper.unmount()
  })
})
