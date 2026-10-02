import { setActivePinia, type Pinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENTS } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import CanvasToolbar from '@/components/game/CanvasToolbar.vue'
import { useGameStore } from '@/stores/game'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'

/**
 * 底部横向工具条的对外行为：工具切换、色板选择、历史操作、清空二次确认上抛、
 * 非画家/非作画阶段整组置灰、顶栏「工具」开关控制显隐。
 * 只断言 v-model 契约与禁用态，不触碰内部样式实现。
 */

let pinia: Pinia

beforeEach(() => {
  pinia = createPiniaWithFakeTransport().pinia
  setActivePinia(pinia)
})

function mountToolbar(
  props: Partial<{
    tool: 'pen' | 'eraser' | 'fill'
    color: string
    width: number
    canDraw: boolean
    visible: boolean
  }> = {},
): VueWrapper {
  return mount(CanvasToolbar, {
    props: {
      tool: 'pen',
      color: '#1F2937',
      width: 5,
      canDraw: true,
      visible: true,
      ...props,
    },
    global: { plugins: [pinia] },
  })
}

describe('CanvasToolbar 交互', () => {
  it('渲染工具条，工具切换经 v-model:tool 上抛', async () => {
    const store = useGameStore()
    const wrapper = mountToolbar()

    expect(
      wrapper.find(`[role="toolbar"][aria-label="${strings.a11y.game.toolbarAria}"]`).exists(),
    ).toBe(true)

    await wrapper
      .get(`[aria-label="${strings.a11y.game.eraserAria(store.settings.eraserShortcut)}"]`)
      .trigger('click')
    expect(wrapper.emitted('update:tool')?.[0]).toEqual(['eraser'])
    wrapper.unmount()
  })

  it('选择预设色经 v-model:color 上抛', async () => {
    const store = useGameStore()
    const nextColor = store.config.drawing.colors.find((paint) => paint !== '#1F2937')!
    const wrapper = mountToolbar()

    await wrapper
      .get(`[aria-label="${strings.a11y.game.presetColorAria(nextColor)}"]`)
      .trigger('click')
    expect(wrapper.emitted('update:color')?.[0]).toEqual([nextColor])
    wrapper.unmount()
  })

  it('撤销/重做直接调用 store.drawAction，清空只上抛 clear 事件', async () => {
    const store = useGameStore()
    const drawAction = vi.spyOn(store, 'drawAction').mockResolvedValue(true as never)
    const wrapper = mountToolbar()

    await wrapper.get(`[aria-label="${strings.a11y.game.undoAria}"]`).trigger('click')
    await wrapper.get(`[aria-label="${strings.a11y.game.redoAria}"]`).trigger('click')
    expect(drawAction).toHaveBeenNthCalledWith(1, EVENTS.drawUndo)
    expect(drawAction).toHaveBeenNthCalledWith(2, EVENTS.drawRedo)

    await wrapper.get(`[aria-label="${strings.a11y.game.clearAria}"]`).trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
    wrapper.unmount()
  })

  it('非画家/非作画阶段整组置灰且不响应操作', async () => {
    const store = useGameStore()
    const drawAction = vi.spyOn(store, 'drawAction').mockResolvedValue(true as never)
    const wrapper = mountToolbar({ canDraw: false })
    const presetColor = store.config.drawing.colors[0]!

    expect(
      (wrapper.get(`[aria-label="${strings.a11y.game.undoAria}"]`).element as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (
        wrapper.get(`[aria-label="${strings.a11y.game.eraserAria(store.settings.eraserShortcut)}"]`)
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      wrapper
        .get(`[aria-label="${strings.a11y.game.presetColorAria(presetColor)}"]`)
        .attributes('aria-disabled'),
    ).toBe('true')

    await wrapper.get(`[aria-label="${strings.a11y.game.undoAria}"]`).trigger('click')
    expect(drawAction).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('visible 为假时不渲染工具条', () => {
    const wrapper = mountToolbar({ visible: false })
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
