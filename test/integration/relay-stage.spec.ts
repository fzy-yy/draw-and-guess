import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, type Pinia } from 'pinia'
import {
  EVENTS,
  RELAY_STEP_COUNT,
  type RelayViewPhase,
  type RoomSnapshot,
  type Stroke,
} from '@draw-guess/shared'
import { PUBLIC_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import GameView from '@/views/GameView.vue'
import GameCanvas from '@/components/game/GameCanvas.vue'
import { useGameStore } from '@/stores/game'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import {
  GUEST_ID,
  HOST_ID,
  STEP_ID,
  createRelayRoomFixture,
  createRoomFixture,
} from '../client/room-fixture'
import { createPiniaWithFakeTransport, type FakeGameTransport } from '../client/fake-game-transport'

/**
 * 接龙舞台骨架的集成级保障（S84）：同一个 `GameView` 三栏骨架按 `room.gameMode` 分流数据源——
 * 接龙房渲染接龙顶栏（模式 + 阶段 + 棒次、上一家 chip + 单个答案 UI）、左栏状态位与右栏聊天，
 * 中央画布取本棒画布；经典房的一切与改造前一致（对比断言 + 既有 game-view-shell 用例）。
 * 另覆盖开局倒计时（`starting`）：该期服务端还没有接龙视图（S22），舞台与顶栏也必须先立起来。
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
  // 假传输的 setConnected 只改 socket 标志；会话快照的 connected 由 bootstrap 的 connect 回调推进，
  // 这里直接置真以贴近线上（HUD 的展示用开局倒计时窗口据此判定「连接中不留锚点」）。
  useSessionStore().connected = true
})

afterEach(() => {
  fakeTransport.transport.destroy()
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

describe('接龙舞台三栏骨架', () => {
  it('作画棒渲染接龙顶栏（模式 + 阶段 + 棒次）、题面、左栏状态位与接龙聊天', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_draw', {
      prompt: '气球',
      ownCanvas: {
        strokes: [],
        undoneStrokeIds: [],
        lastSequence: -1,
        drawingRevision: 0,
      },
    })

    const wrapper = mountGameView()

    // 顶栏左栏：模式 + 阶段短名 + 「第 1 棒 / 共 4 棒」
    expect(wrapper.text()).toContain(strings.ui.room.modeRelay)
    expect(wrapper.text()).toContain(strings.ui.game.relayPhaseDraw)
    expect(wrapper.text()).toContain(strings.ui.game.relayStepPrefix)
    expect(wrapper.text()).toContain(strings.ui.game.relayStepTotal(4))
    // 正中：本棒题面（作画棒只有一个答案 UI，没有题目遮罩切换）
    expect(wrapper.text()).toContain('气球')
    // 左栏：状态位按快照渲染（本步尚未提交）
    expect(wrapper.text()).toContain(strings.ui.game.relayNotSubmitted)
    // 右栏：接龙聊天（标题与占位为接龙语义）
    expect(wrapper.text()).toContain(strings.ui.game.relayChatTitle)
    // 中央：本棒画布就在三栏中央，作画棒可绘制且工具条可见
    expect(wrapper.find('canvas').exists()).toBe(true)
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(true)
    // 接龙不渲染经典的画布状态遮罩：中栏里没有覆盖画布的 pointer-events-none 层
    //（经典遮罩会把接龙要看的画作与题面挡掉）
    const midColumn = wrapper
      .findAll('div')
      .find((column) => column.classes().includes('w-[62cqw]'))
    expect(midColumn).toBeDefined()
    expect(midColumn!.find('div.pointer-events-none').exists()).toBe(false)

    wrapper.unmount()
  })

  it('猜词棒只读渲染上家画作，上一家 chip 带画笔角标且不显示工具条', () => {
    const previous = strokeFixture('00000000-0000-4000-8000-000000000008', 0)
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_guess', {
      currentStep: 2,
      previousDrawing: {
        strokes: [previous],
        undoneStrokeIds: [],
        lastSequence: 0,
        drawingRevision: 1,
      },
      previousArtist: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' },
    })

    const wrapper = mountGameView()

    // 题面是提示语（看图猜词），不是某个词
    expect(wrapper.text()).toContain(strings.ui.game.relayGuessPrompt)
    // 上一家 chip：昵称可见，画笔角标随「他画了你看的这幅画」挂出
    expect(wrapper.text()).toContain('猜词者')
    expect(wrapper.find('span[aria-hidden="true"]').exists()).toBe(true)
    // 画布数据源＝上家的画作（只读），且猜词棒没有底部工具条
    const canvas = wrapper.findComponent(GameCanvas)
    expect(canvas.props('strokes')).toEqual([previous])
    expect(canvas.props('canDraw')).toBe(false)
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(false)
    // 猜词棒没有候选与底部工具条（写答案的浮层由工单 10 提供）：左栏显示提交进度
    expect(wrapper.text()).toContain(strings.ui.game.relayNotSubmitted)

    wrapper.unmount()
  })

  it('选词卡复用经典标记，点击候选词经 store 按步骤 id 发送选词请求', async () => {
    const WORD_ID = '00000000-0000-4000-8000-000000000009'
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_choose', {
      wordOptions: [{ id: WORD_ID, text: '长颈鹿' }],
      canReroll: true,
    })

    const wrapper = mountGameView()
    const option = wrapper.findAll('button').find((button) => button.text().includes('长颈鹿'))
    expect(option).toBeDefined()
    await option!.trigger('click')
    await flushPromises()

    expect(fakeTransport.requests.at(-1)).toMatchObject({
      event: EVENTS.gameChooseWord,
      // 接龙沿用经典事件名，但目标 id 是**当前步骤 id**（经典侧是回合 id，S53）
      payload: { roundId: STEP_ID, wordId: WORD_ID },
    })

    wrapper.unmount()
  })

  it('经典房不渲染任何接龙部件：顶栏仍是 ROUND 胶囊、聊天仍是猜词频道', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')

    const wrapper = mountGameView()

    expect(wrapper.text()).toContain(strings.ui.game.roundLabel)
    expect(wrapper.text()).toContain(strings.ui.game.chatTitle)
    expect(wrapper.text()).not.toContain(strings.ui.game.relayChatTitle)
    expect(wrapper.text()).not.toContain(strings.ui.game.relayStepPrefix)
    expect(wrapper.text()).not.toContain(strings.ui.game.relaySubmitted)

    wrapper.unmount()
  })
})

describe('接龙 store 与 façade 接线', () => {
  it('接龙房选词走当前步骤 id，经典房仍是回合 id', async () => {
    const store = useGameStore()
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_choose')
    await store.chooseWord('00000000-0000-4000-8000-00000000000a')
    expect(fakeTransport.requests.at(-1)?.payload).toMatchObject({ roundId: STEP_ID })

    roomStore.room = createRoomFixture('choosing_word')
    await store.chooseWord('00000000-0000-4000-8000-00000000000b')
    expect(fakeTransport.requests.at(-1)?.payload).toMatchObject({
      roundId: roomStore.room.game?.roundId,
    })
  })

  it('接龙聊天走 chat:say，永不经过猜词事件', async () => {
    const store = useGameStore()
    useRoomStore().room = createRelayRoomFixture('relay_guess', { currentStep: 2 })
    await store.relayChat('大家画得真快')
    expect(fakeTransport.requests.at(-1)).toMatchObject({
      event: EVENTS.chatSay,
      payload: { text: '大家画得真快' },
    })
    expect(fakeTransport.requests.some((request) => request.event === EVENTS.guessSubmit)).toBe(
      false,
    )
  })

  it('作画棒上传笔画走接龙事件并自补本地镜像（服务端零广播，画布不能靠推送回填）', async () => {
    const stroke = strokeFixture('00000000-0000-4000-8000-00000000000c', 0)
    useRoomStore().room = createRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: -1, drawingRevision: 0 },
    })
    fakeTransport.setResponder((_event, payload) => ({
      ok: true,
      requestId: String(payload.requestId),
      data: { strokeId: stroke.id, pointCount: 1, drawingRevision: 1, remainingBudget: 40_000 },
    }))

    const store = useGameStore()
    await store.relaySendStroke(stroke)

    expect(fakeTransport.requests.at(-1)).toMatchObject({
      event: EVENTS.relayDrawStrokeBatch,
      payload: { stepId: STEP_ID },
    })
    const mirrored = store.room?.relay?.ownCanvas
    expect(mirrored?.strokes).toHaveLength(1)
    expect(mirrored?.drawingRevision).toBe(1)
    expect(mirrored?.lastSequence).toBe(0)
  })

  it('接龙画布上传前后画布数据源都指向本棒画布，ack 后本地镜像即出现在画布 props 上', async () => {
    const stroke = strokeFixture('00000000-0000-4000-8000-00000000000d', 0)
    useRoomStore().room = createRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: -1, drawingRevision: 0 },
    })
    fakeTransport.setResponder((_event, payload) => ({
      ok: true,
      requestId: String(payload.requestId),
      data: { strokeId: stroke.id, pointCount: 1, drawingRevision: 1, remainingBudget: 40_000 },
    }))
    const wrapper = mountGameView()
    const store = useGameStore()
    await store.relaySendStroke(stroke)
    await flushPromises()

    expect(wrapper.findComponent(GameCanvas).props('strokes')).toHaveLength(1)
    expect(wrapper.findComponent(GameCanvas).props('revision')).toBe(1)

    wrapper.unmount()
  })

  it('既非接龙也非经典对局时不挂载舞台（房间守卫不变）', () => {
    const roomStore = useRoomStore()
    const snapshot = createRoomFixture('drawing')
    delete snapshot.game
    roomStore.room = snapshot
    const wrapper = mountGameView()
    expect(wrapper.find('canvas').exists()).toBe(false)
    wrapper.unmount()
  })
})

/** 三个接龙对局阶段共用同一套舞台骨架：逐个阶段确认顶栏与画布都在（接龙房没有经典 `game` 字段）。 */
const RELAY_PLAY_PHASES: readonly RelayViewPhase[] = ['relay_choose', 'relay_draw', 'relay_guess']
describe('接龙阶段夹具自检', () => {
  it('三个接龙对局阶段都能渲染出顶栏与画布（无经典 game 字段也成立）', () => {
    const roomStore = useRoomStore()
    for (const phase of RELAY_PLAY_PHASES) {
      roomStore.room = createRelayRoomFixture(phase)
      const wrapper = mountGameView()
      expect(wrapper.find(`header[aria-label="${strings.a11y.game.topBarAria}"]`).exists()).toBe(
        true,
      )
      expect(wrapper.find('canvas').exists()).toBe(true)
      expect(wrapper.text()).toContain(strings.ui.room.modeRelay)
      wrapper.unmount()
    }
  })
})

/**
 * 接龙开局倒计时夹具：房间已进 `starting`，但服务端的接龙阶段白名单（S22）决定该期**没有** relay 视图，
 * 快照形状因此是「接龙房 + starting + 无 relay 视图 + 无经典 game」——改造前正是这一形状让舞台整屏空白。
 */
function createRelayStartingFixture(): RoomSnapshot {
  const snapshot = createRelayRoomFixture()
  snapshot.phase = 'starting'
  delete snapshot.relay
  return snapshot
}

describe('接龙开局倒计时（starting）', () => {
  const NEXT_WORD_ID = '00000000-0000-4000-8000-00000000000e'

  it('倒计时期就渲染三栏骨架与接龙顶栏：不回落经典 ROUND 胶囊、不报空引用', () => {
    useRoomStore().room = createRelayStartingFixture()

    const wrapper = mountGameView()

    // 三栏骨架先立起来（改造前这 3 秒整屏空白）
    expect(wrapper.find('main').exists()).toBe(true)
    expect(wrapper.find('canvas').exists()).toBe(true)
    // 左栏玩家面板与右栏接龙聊天都在
    expect(wrapper.text()).toContain('房主')
    expect(wrapper.text()).toContain(strings.ui.game.relayChatTitle)
    // 顶栏在，且按「接龙房 + 房间阶段」渲染：模式标签 + 准备开始；回落成经典 ROUND 胶囊即失败
    expect(wrapper.find(`header[aria-label="${strings.a11y.game.topBarAria}"]`).exists()).toBe(true)
    expect(wrapper.text()).toContain(strings.ui.room.modeRelay)
    expect(wrapper.text()).toContain(strings.ui.status.phaseStarting)
    expect(wrapper.text()).not.toContain(strings.ui.game.roundLabel)
    // 还没有 relay 视图，故不出现棒次胶囊与接龙题面
    expect(wrapper.text()).not.toContain(strings.ui.game.relayStepTotal(RELAY_STEP_COUNT))
    expect(wrapper.text()).toContain(strings.ui.game.awaitingWord)
    // 开局遮罩照常出现，大数字按公开配置的开局时长倒数（该期没有权威截止时间，见 useGameHud 注释）
    expect(wrapper.text()).toContain(String(PUBLIC_CONFIG.game.startingCountdownSeconds))

    wrapper.unmount()
  })

  it('relay_choose 快照到达后舞台不重挂：同一个 main 与画布 DOM 实例延续', async () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayStartingFixture()
    const wrapper = mountGameView()

    const stage = wrapper.find('main').element
    const canvas = wrapper.find('canvas').element

    // 服务端推进到第 1 棒选词：同一套骨架就地续上，选词卡直接盖在已立起的舞台上
    roomStore.room = createRelayRoomFixture('relay_choose', {
      wordOptions: [{ id: NEXT_WORD_ID, text: '长颈鹿' }],
      canReroll: true,
    })
    await nextTick()

    expect(wrapper.find('main').element).toBe(stage)
    expect(wrapper.find('canvas').element).toBe(canvas)
    // 选词卡是接龙文案（S83），不是经典标题
    expect(wrapper.text()).toContain(strings.ui.game.relayChooseTitle)
    expect(wrapper.text()).not.toContain(strings.ui.game.yourTurn)
    expect(wrapper.text()).toContain('长颈鹿')

    wrapper.unmount()
  })
})
