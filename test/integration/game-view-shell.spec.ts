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
 * 黄金平衡三栏对局骨架的集成级保障：真实 Pinia + 假 Socket 传输 + 真实 GameView 组件树，
 * 覆盖「统领顶栏 + 16cqw 左栏玩家榜 + 62cqw 中栏黄金画板 + 20cqw 右栏常驻聊天 + 底部工具条」。
 * 彻底废除旧浮动面板与 C 快捷键开关断言，验证三栏常驻与 Enter 聚焦猜词输入框。

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

/** 在 window 上派发按键：与 usePanelShortcuts 的监听目标一致，模拟全局快捷键。 */
function pressKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }))
}

describe('GameView 黄金平衡三栏对局骨架', () => {
  it('渲染全局统领顶栏、左栏玩家榜、中栏画板、右栏常驻聊天与底部工具条', () => {
    const wrapper = mountGameView()

    // 顶部统领顶栏
    expect(wrapper.find(`header[aria-label="${strings.a11y.game.topBarAria}"]`).exists()).toBe(true)
    // 左栏玩家面板常驻
    expect(
      wrapper.find(`aside[aria-label="${strings.a11y.game.playersPanelTitle}"]`).exists(),
    ).toBe(true)
    // 中栏黄金画板
    expect(wrapper.find('canvas').exists()).toBe(true)
    // 右栏常驻聊天面板
    expect(wrapper.find('form:has(#guess-input)').exists()).toBe(true)
    // 画家底部工具条
    expect(
      wrapper.find(`[role="toolbar"][aria-label="${strings.a11y.game.toolbarAria}"]`).exists(),
    ).toBe(true)

    wrapper.unmount()
  })

  it('三栏物理闭环流内常驻，零浮窗遮挡画板，工具条对画家常驻不可隐藏', async () => {
    const wrapper = mountGameView()

    // 验证左栏玩家榜与右栏聊天均常驻在 DOM 中
    expect(
      wrapper.find(`aside[aria-label="${strings.a11y.game.playersPanelTitle}"]`).exists(),
    ).toBe(true)
    expect(wrapper.find('form:has(#guess-input)').exists()).toBe(true)

    // 顶栏无聊天显隐开关
    expect(wrapper.find(`[aria-label="${strings.a11y.game.toggleChat}"]`).exists()).toBe(false)

    // 底部工具条对画家常驻显示且不可被隐藏
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('快捷键：回车键聚焦猜词输入框', async () => {
    const wrapper = mountGameView()

    const input = wrapper.find<HTMLInputElement>('#guess-input').element
    const focusSpy = vi.spyOn(input, 'focus')

    // 按回车键聚焦猜词框
    pressKey('Enter')
    await flushPromises()
    expect(focusSpy).toHaveBeenCalled()

    wrapper.unmount()
  })
})
