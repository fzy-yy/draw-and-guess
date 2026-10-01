import { defineComponent, h, nextTick, ref } from 'vue'
import { setActivePinia, type Pinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strings } from '@draw-guess/strings'
import FloatingPanel from '@/components/game/FloatingPanel.vue'
import GameHud from '@/components/game/GameHud.vue'
import type { PanelPosition } from '@/components/game'
import { useRoomStore } from '@/stores/room'
import { createRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'

/**
 * 浮层面板壳的对外行为：
 * 开合（v-model:open）、标题栏拖动的位置夹取、关闭按钮、与顶栏开关共用同一份开关状态。
 * 只断言渲染与 v-model 契约，不触碰内部拖动簿记。
 */

/** 构造一个可测量的矩形（happy-dom 布局尺寸恒为 0，拖动用例显式注入）。 */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

describe('FloatingPanel 开合与关闭', () => {
  it('默认渲染标题与内容，关闭按钮写回 open=false', async () => {
    const wrapper = mount(FloatingPanel, {
      props: { open: true, title: strings.game.playersPanelTitle },
      slots: { default: '成员列表' },
    })

    expect(wrapper.get('section').text()).toContain(strings.game.playersPanelTitle)
    expect(wrapper.text()).toContain('成员列表')

    await wrapper.get(`[aria-label="${strings.game.closePanelAria}"]`).trigger('click')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('open 为假时不渲染面板', () => {
    const wrapper = mount(FloatingPanel, {
      props: { open: false, title: strings.game.chatPanelTitle },
    })
    expect(wrapper.find('section').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('FloatingPanel 标题栏拖动', () => {
  /** 用真实 PointerEvent 驱动拖动：VTU trigger 无法可靠携带 clientX/pointerId。 */
  function pointer(
    type: string,
    target: HTMLElement,
    { clientX, clientY, pointerId = 1 }: { clientX: number; clientY: number; pointerId?: number },
  ): void {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, clientX, clientY, pointerId }),
    )
  }

  it('拖动被夹取在工作区内，不会把面板拖出画布', async () => {
    const wrapper = mount(FloatingPanel, {
      props: { open: true, position: { x: 0, y: 0 }, title: strings.game.playersPanelTitle },
    })
    const panel = wrapper.get('section').element as HTMLElement
    const workspace = panel.parentElement as HTMLElement
    // 工作区 1000×500，面板 100×200 → 左上角极限百分比 x=90 / y=60
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 500))
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 200))
    const header = wrapper.get('header').element as HTMLElement

    pointer('pointerdown', header, { clientX: 10, clientY: 10 })
    pointer('pointermove', header, { clientX: 510, clientY: 260 })
    pointer('pointermove', header, { clientX: 3010, clientY: 10 })
    pointer('pointermove', header, { clientX: -9990, clientY: 5260 })

    const emitted = wrapper.emitted('update:position') as PanelPosition[][]
    expect(emitted.map(([value]) => value)).toEqual([
      { x: 50, y: 50 },
      { x: 90, y: 0 },
      { x: 0, y: 60 },
    ])
    wrapper.unmount()
  })

  it('正文区不响应拖动，只有标题栏是拖动手柄', async () => {
    const wrapper = mount(FloatingPanel, {
      props: { open: true, position: { x: 0, y: 0 }, title: strings.game.chatPanelTitle },
      slots: { default: '<p class="content">正文</p>' },
    })
    const panel = wrapper.get('section').element as HTMLElement
    const workspace = panel.parentElement as HTMLElement
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 500))
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 200))

    pointer('pointerdown', wrapper.get('.content').element as HTMLElement, {
      clientX: 10,
      clientY: 10,
    })
    pointer('pointermove', wrapper.get('section').element as HTMLElement, {
      clientX: 510,
      clientY: 260,
    })
    expect(wrapper.emitted('update:position')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('FloatingPanel 与顶栏开关联动', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = createPiniaWithFakeTransport().pinia
    setActivePinia(pinia)
  })

  /** 复刻 GameView 的绑定：顶栏开关与面板共用同一个 open 引用，两处都能改它。 */
  function mountSharedOpen(): VueWrapper {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')
    const game = roomStore.room.game

    const Harness = defineComponent({
      components: { GameHud, FloatingPanel },
      setup() {
        const playersOpen = ref(true)
        const chatOpen = ref(true)
        const toolsOpen = ref(true)
        return () =>
          h('div', [
            h(GameHud, {
              isFullscreen: false,
              game,
              secondsLeft: 30,
              progress: 0.5,
              showTools: false,
              playersOpen: playersOpen.value,
              'onUpdate:playersOpen': (value: boolean) => (playersOpen.value = value),
              chatOpen: chatOpen.value,
              'onUpdate:chatOpen': (value: boolean) => (chatOpen.value = value),
              toolsOpen: toolsOpen.value,
              'onUpdate:toolsOpen': (value: boolean) => (toolsOpen.value = value),
            }),
            h(
              FloatingPanel,
              {
                open: playersOpen.value,
                'onUpdate:open': (value: boolean) => (playersOpen.value = value),
                title: strings.game.playersPanelTitle,
              },
              { default: () => h('p', '成员列表') },
            ),
          ])
      },
    })

    return mount(Harness, { global: { plugins: [pinia] } })
  }

  it('顶栏按钮可收起面板，面板内关闭按钮也能收起同一份状态', async () => {
    const wrapper = mountSharedOpen()
    const toggle = wrapper.get(`[aria-label="${strings.game.togglePlayers}"]`)
    const panelTitle = strings.game.playersPanelTitle

    // 顶栏开关 → 收起
    await toggle.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('section').some((node) => node.text().includes(panelTitle))).toBe(false)

    // 顶栏开关 → 重新打开
    await toggle.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('section').some((node) => node.text().includes(panelTitle))).toBe(true)

    // 面板内关闭按钮 → 同样收起（证明两处写的是同一份 open）
    const panel = wrapper.findAll('section').find((node) => node.text().includes(panelTitle))!
    await panel.get(`[aria-label="${strings.game.closePanelAria}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.findAll('section').some((node) => node.text().includes(panelTitle))).toBe(false)
    wrapper.unmount()
  })
})

describe('FloatingPanel 跨面板层级（模块级共享）', () => {
  /**
   * 缺陷回归：层级计数器原先写在 `<script setup>` 内，每个实例各持一份，两个面板互相置顶失效。
   * 这里挂载两个真实面板，断言「后点击者在上」且层级始终低于阶段遮罩（z-30）。
   */
  it('后点击的面板置顶，且层级始终低于阶段遮罩', async () => {
    const first = mount(FloatingPanel, {
      props: { open: true, title: strings.game.playersPanelTitle },
    })
    const second = mount(FloatingPanel, {
      props: { open: true, title: strings.game.chatPanelTitle },
    })
    const firstSection = first.get('section').element as HTMLElement
    const secondSection = second.get('section').element as HTMLElement
    const zIndex = (element: HTMLElement): number => Number(element.style.zIndex)

    // 第二个面板登记时可能触发一次整体重排：等待重排后的层级落地再断言。
    await nextTick()

    // 起始都低于阶段遮罩，且后挂载者默认在上
    expect(zIndex(firstSection)).toBeLessThan(30)
    expect(zIndex(secondSection)).toBeGreaterThan(zIndex(firstSection))

    // 点击先挂载的面板 → 跨实例置顶生效
    await first.get('section').trigger('pointerdown')
    expect(zIndex(firstSection)).toBeGreaterThan(zIndex(secondSection))
    expect(zIndex(firstSection)).toBeLessThan(30)

    // 反复交替置顶会触发内部压缩，层级不得突破阶段遮罩
    for (let round = 0; round < 20; round += 1) {
      await first.get('section').trigger('pointerdown')
      await second.get('section').trigger('pointerdown')
    }
    expect(zIndex(secondSection)).toBeGreaterThan(zIndex(firstSection))
    expect(zIndex(firstSection)).toBeLessThan(30)
    expect(zIndex(secondSection)).toBeLessThan(30)

    first.unmount()
    second.unmount()
  })
})
