import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, type Pinia } from 'pinia'
import { strings } from '@draw-guess/strings'
import GameView from '@/views/GameView.vue'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { createRoomFixture, HOST_ID } from '../client/room-fixture'
import { createPiniaWithFakeTransport, type FakeGameTransport } from '../client/fake-game-transport'

/**
 * 新对局骨架（浮层布局）的集成级保障：真实 Pinia + 假 Socket 传输 + 真实 GameView 组件树，
 * 覆盖「顶栏 + 铺满画布 + 常驻玩家面板 + 浮层聊天面板 + 底部工具条」以及顶栏开关对面板/工具条显隐的驱动。
 *
 * 这是规格「Testing Decisions」要求补的最高缝之下的集成用例：断言外部可观察结果（DOM 结构
 * 与显隐），不触碰组件私有状态。happy-dom 不实现 Canvas 2D 与布局，这里提供最小上下文替身
 * （与 GameCanvas 组件测试同构）；MSW 网络边界与音频/焦点陷阱替身由 integration setup 统一提供。
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

  // 本机设为房主兼当前画家：顶栏会显示「工具」开关，底部工具条默认可见。
  useSessionStore().playerId = HOST_ID
  useRoomStore().room = createRoomFixture('drawing')
})

afterEach(() => {
  fakeTransport.transport.destroy()
})

/** 挂载完整对局视图（真实子组件树），返回包装器由用例断言并卸载。 */
function mountGameView(): VueWrapper {
  return mount(GameView, { global: { plugins: [pinia] } })
}

/** 按标题定位浮层面板：只匹配 FloatingPanel 渲染的 section。 */
function findPanel(wrapper: VueWrapper, title: string): boolean {
  return wrapper.findAll('section').some((node) => node.text().includes(title))
}

/** 定位常驻玩家左栏：它是普通 aside（不是浮层 section），按 aria-label 判定。 */
function hasPlayersColumn(wrapper: VueWrapper): boolean {
  return wrapper.find(`aside[aria-label="${strings.a11y.game.playersPanelTitle}"]`).exists()
}

/** 在 window 上派发按键：与 usePanelShortcuts 的监听目标一致，模拟全局快捷键。 */
function pressKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }))
}

describe('GameView 新对局骨架', () => {
  it('渲染顶栏、铺满画布、玩家常驻左栏、聊天浮层与底部工具条', () => {
    const wrapper = mountGameView()

    expect(wrapper.find(`header[aria-label="${strings.a11y.game.topBarAria}"]`).exists()).toBe(true)
    expect(wrapper.find('canvas').exists()).toBe(true)
    expect(hasPlayersColumn(wrapper)).toBe(true)
    expect(findPanel(wrapper, strings.ui.game.chatPanelTitle)).toBe(true)
    expect(
      wrapper.find(`[role="toolbar"][aria-label="${strings.a11y.game.toolbarAria}"]`).exists(),
    ).toBe(true)

    wrapper.unmount()
  })

  it('顶栏开关可收起并重新打开聊天面板与工具条，玩家面板常驻左栏', async () => {
    const wrapper = mountGameView()

    // 玩家面板是常驻左栏：不参与开关，始终在 DOM 中
    expect(hasPlayersColumn(wrapper)).toBe(true)
    expect(wrapper.find(`[aria-label="${strings.a11y.game.toggleChat}"]`).exists()).toBe(true)

    expect(findPanel(wrapper, strings.ui.game.chatPanelTitle)).toBe(true)

    // 顶栏「聊天面板」开关 → 收起聊天面板
    await wrapper.get(`[aria-label="${strings.a11y.game.toggleChat}"]`).trigger('click')
    await flushPromises()
    expect(findPanel(wrapper, strings.ui.game.chatPanelTitle)).toBe(false)
    // 收起聊天不影响常驻玩家左栏
    expect(hasPlayersColumn(wrapper)).toBe(true)

    // 再次点击同一开关 → 重新打开聊天面板
    await wrapper.get(`[aria-label="${strings.a11y.game.toggleChat}"]`).trigger('click')
    await flushPromises()
    expect(findPanel(wrapper, strings.ui.game.chatPanelTitle)).toBe(true)

    // 顶栏「绘图工具」开关 → 收起底部工具条
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(true)
    await wrapper.get(`[aria-label="${strings.a11y.game.toggleTools}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('面板快捷键：C/T 开关对应面板，回车只打开不隐藏，输入控件聚焦时让位', async () => {
    const wrapper = mountGameView()

    // 回车：聊天已打开时只聚焦、不隐藏
    pressKey('Enter')
    await flushPromises()
    expect(findPanel(wrapper, strings.ui.game.chatPanelTitle)).toBe(true)

    // C：关掉聊天后再用回车打开（回车永不隐藏）
    pressKey('c')
    await flushPromises()
    expect(findPanel(wrapper, strings.ui.game.chatPanelTitle)).toBe(false)
    pressKey('Enter')
    await flushPromises()
    expect(findPanel(wrapper, strings.ui.game.chatPanelTitle)).toBe(true)

    // T：底部工具条开 ↔ 关（本机为画家）
    pressKey('t')
    await flushPromises()
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(false)
    pressKey('t')
    await flushPromises()
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(true)

    // 输入控件聚焦时快捷键让位：事件目标是可编辑元素，面板不受影响
    const input = wrapper.find('input').element
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
    await flushPromises()
    expect(findPanel(wrapper, strings.ui.game.chatPanelTitle)).toBe(true)

    wrapper.unmount()
  })
})
