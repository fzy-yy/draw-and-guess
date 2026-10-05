import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, type Pinia } from 'pinia'
import { EVENTS } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import GameView from '@/views/GameView.vue'
import ChatPanel from '@/components/game/ChatPanel.vue'
import CanvasToolbar from '@/components/game/CanvasToolbar.vue'
import RelayAnswerPanel from '@/components/game/relay/RelayAnswerPanel.vue'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import {
  GUEST_ID,
  HOST_ID,
  STEP_ID,
  createLiveRelayRoomFixture,
  createRoomFixture,
} from '../client/room-fixture'
import { createPiniaWithFakeTransport, type FakeGameTransport } from '../client/fake-game-transport'

/**
 * 接龙作答与聊天的集成缝（工单 10；依据 S20 / S30 / S41 / S64 / S79）：
 * - 作答浮层挂在中栏画布容器内、底部工具条之后；
 * - 作答走 `relay:submitGuess` / `relay:submitDrawing`，聊天走 `chat:say`——两个输入通道互不串；
 * - 左栏「已提交 / 未提交」纯按快照的 `submittedPlayerIds` 渲染：本地提交不自行推断，
 *   服务端超时 / 掉线代交后界面随快照同步为已提交。
 */

/** 最小 Canvas 2D 上下文替身：与 relay-stage 用例同源，只保证画布组件可挂载。 */
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

/** 空画布：作画棒需要「有自己的画布」才挂载完成提交入口。 */
const EMPTY_CANVAS = {
  strokes: [],
  undoneStrokeIds: [],
  lastSequence: -1,
  drawingRevision: 0,
}

let pinia: Pinia
let fakeTransport: FakeGameTransport

beforeEach(() => {
  // happy-dom 无 Canvas 2D 与布局：固定尺寸，保证画布逻辑栅格推导确定。
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
})

/** 挂载完整对局视图（真实子组件树）。 */
function mountGameView(): VueWrapper {
  return mount(GameView, { global: { plugins: [pinia] } })
}

describe('接龙作答浮层挂载点', () => {
  it('猜词棒：浮层挂在中栏画布容器内、底部工具条之后', () => {
    useRoomStore().room = createLiveRelayRoomFixture('relay_guess', {
      currentStep: 2,
      previousDrawing: EMPTY_CANVAS,
    })
    const wrapper = mountGameView()

    const middleColumn = wrapper.findAll('div').find((node) => node.classes().includes('w-[62cqw]'))
    expect(middleColumn).toBeDefined()

    const panel = middleColumn!.findComponent(RelayAnswerPanel)
    expect(panel.exists()).toBe(true)
    // 与工具条同层且排在其后：同一父容器内的 DOM 顺序直接表达「工具条之后」
    const siblings = Array.from(middleColumn!.element.children)
    const toolbar = middleColumn!.findComponent(CanvasToolbar)
    expect(siblings.indexOf(panel.element)).toBeGreaterThan(siblings.indexOf(toolbar.element))

    wrapper.unmount()
  })

  it('经典房与接龙选词期都不挂载作答浮层', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')
    const classic = mountGameView()
    expect(classic.findComponent(RelayAnswerPanel).exists()).toBe(false)
    classic.unmount()

    roomStore.room = createLiveRelayRoomFixture('relay_choose')
    const choosing = mountGameView()
    expect(choosing.findComponent(RelayAnswerPanel).exists()).toBe(false)
    choosing.unmount()
  })
})

describe('接龙作答与聊天互不串（S20 / S79）', () => {
  it('作答浮层提交走 relay:submitGuess，整段交互不产生聊天事件', async () => {
    useRoomStore().room = createLiveRelayRoomFixture('relay_guess', {
      currentStep: 2,
      previousDrawing: EMPTY_CANVAS,
    })
    const wrapper = mountGameView()
    const panel = wrapper.findComponent(RelayAnswerPanel)

    await panel.find('input').setValue('长颈鹿')
    await panel.find('form').trigger('submit')
    await flushPromises()

    expect(fakeTransport.requests.at(-1)).toMatchObject({
      event: EVENTS.relaySubmitGuess,
      payload: { stepId: STEP_ID, text: '长颈鹿' },
    })
    // 作答内容不进聊天流：聊天事件在整段交互里从未出现
    expect(fakeTransport.requests.some((request) => request.event === EVENTS.chatSay)).toBe(false)
    // 提交后浮层锁定为等待态，输入框收起
    expect(panel.text()).toContain(strings.ui.game.relayWaitingOthers)
    expect(panel.find('input').exists()).toBe(false)

    wrapper.unmount()
  })

  it('右栏聊天提交只走 chat:say：聊天通道永远不会发出作答事件', async () => {
    useRoomStore().room = createLiveRelayRoomFixture('relay_guess', {
      currentStep: 2,
      previousDrawing: EMPTY_CANVAS,
    })
    const wrapper = mountGameView()
    const chat = wrapper.findComponent(ChatPanel)

    await chat.find('#guess-input').setValue('大家画得真快')
    await chat.find('form').trigger('submit')
    await flushPromises()

    expect(fakeTransport.requests.at(-1)).toMatchObject({
      event: EVENTS.chatSay,
      payload: { text: '大家画得真快' },
    })
    expect(
      fakeTransport.requests.some((request) => request.event === EVENTS.relaySubmitGuess),
    ).toBe(false)

    wrapper.unmount()
  })

  it('作答不进聊天流：提交答案后右侧聊天流里不出现作答内容', async () => {
    // 接龙房没有经典 `game`，房间级自由聊天在 `relay.messages`（与作答彻底分离，S79 / S20）
    const chatMessage = {
      id: '00000000-0000-4000-8000-0000000000aa',
      type: 'preset' as const,
      text: '大家画得真快',
      playerId: GUEST_ID,
      createdAt: 1_000,
    }
    useRoomStore().room = createLiveRelayRoomFixture('relay_guess', {
      currentStep: 2,
      previousDrawing: EMPTY_CANVAS,
      messages: [chatMessage],
    })
    const wrapper = mountGameView()
    const chat = wrapper.findComponent(ChatPanel)
    expect(chat.text()).toContain('大家画得真快')

    const panel = wrapper.findComponent(RelayAnswerPanel)
    await panel.find('input').setValue('长颈鹿')
    await panel.find('form').trigger('submit')
    await flushPromises()

    expect(fakeTransport.requests.at(-1)).toMatchObject({ event: EVENTS.relaySubmitGuess })
    // 作答只走作答事件：既没有变成聊天事件，也没有进入聊天流
    expect(fakeTransport.requests.some((request) => request.event === EVENTS.chatSay)).toBe(false)
    expect(chat.text()).not.toContain('长颈鹿')

    wrapper.unmount()
  })

  it('作画棒的完成提交走 relay:submitDrawing（只标记完成，不带文本）', async () => {
    useRoomStore().room = createLiveRelayRoomFixture('relay_draw', { ownCanvas: EMPTY_CANVAS })
    const wrapper = mountGameView()
    const panel = wrapper.findComponent(RelayAnswerPanel)

    expect(panel.text()).toContain(strings.ui.game.relayDrawingSubmit)
    await panel.find('button').trigger('click')
    await flushPromises()

    expect(fakeTransport.requests.at(-1)).toMatchObject({
      event: EVENTS.relaySubmitDrawing,
      payload: { stepId: STEP_ID },
    })
    expect(fakeTransport.requests.some((request) => request.event === EVENTS.chatSay)).toBe(false)
    expect(panel.text()).toContain(strings.ui.game.relayWaitingOthers)

    wrapper.unmount()
  })
})

describe('左栏提交状态跟随服务端快照（S41 / S64）', () => {
  it('纯按 submittedPlayerIds 渲染，服务端代交后本人浮层与左栏一起同步为已提交', async () => {
    const roomStore = useRoomStore()
    roomStore.room = createLiveRelayRoomFixture('relay_guess', {
      currentStep: 2,
      previousDrawing: EMPTY_CANVAS,
      submittedPlayerIds: [GUEST_ID],
    })
    const wrapper = mountGameView()

    // 快照：另一位玩家已提交、本人未提交 —— 左栏逐人表达，不含数目
    const before = wrapper.find('aside').text()
    expect(before).toContain(strings.ui.game.relaySubmitted)
    expect(before).toContain(strings.ui.game.relayNotSubmitted)
    expect(wrapper.findComponent(RelayAnswerPanel).find('input').exists()).toBe(true)

    // 服务端超时 / 掉线代为提交：快照把本人也列入已提交
    roomStore.room = createLiveRelayRoomFixture('relay_guess', {
      currentStep: 2,
      previousDrawing: EMPTY_CANVAS,
      submitted: true,
      submittedPlayerIds: [GUEST_ID, HOST_ID],
    })
    await flushPromises()

    const after = wrapper.find('aside').text()
    expect(after).toContain(strings.ui.game.relaySubmitted)
    expect(after).not.toContain(strings.ui.game.relayNotSubmitted)
    // 本人浮层跟随快照锁定为等待态，且客户端没有补发作答请求（状态只读快照，不本地推断）
    expect(wrapper.findComponent(RelayAnswerPanel).text()).toContain(
      strings.ui.game.relayWaitingOthers,
    )
    expect(
      fakeTransport.requests.some((request) => request.event === EVENTS.relaySubmitGuess),
    ).toBe(false)

    wrapper.unmount()
  })
})
