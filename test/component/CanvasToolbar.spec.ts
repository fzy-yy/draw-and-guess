import { setActivePinia, type Pinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENTS, type ToolKind } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import CanvasToolbar from '@/components/game/CanvasToolbar.vue'
import { useGameStore } from '@/stores/game'
import * as audioModule from '@/audio'
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
    tool: ToolKind
    color: string
    width: number
    canDraw: boolean
    visible: boolean
    showRelaySubmit: boolean
    relaySubmitted: boolean
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

  it('选择预设色经 v-model:color 上抛，若当前为橡皮则自动切回画笔', async () => {
    const store = useGameStore()
    const nextColor = store.config.drawing.colors.find((paint) => paint !== '#1F2937')!
    const wrapper = mountToolbar({ tool: 'eraser' })

    await wrapper
      .get(`[aria-label="${strings.a11y.game.presetColorAria(nextColor)}"]`)
      .trigger('click')
    expect(wrapper.emitted('update:color')?.[0]).toEqual([nextColor])
    expect(wrapper.emitted('update:tool')?.[0]).toEqual(['pen'])
    wrapper.unmount()
  })

  it('自定义取色预览时静音，取色提交时播放音效', async () => {
    const soundSpy = vi.spyOn(audioModule, 'playInteractionSound')
    const wrapper = mountToolbar()

    const customSwatch = wrapper
      .findAllComponents({ name: 'ColorSwatchButton' })
      .find((c) => c.props('custom') === true)!
    soundSpy.mockClear()

    // 拖动预览：触发 select，更新颜色但保持静音
    await customSwatch.vm.$emit('select', '#FF5500')
    expect(wrapper.emitted('update:color')?.[0]).toEqual(['#FF5500'])
    expect(soundSpy).not.toHaveBeenCalled()

    // 确认提交：触发 commit，播放交互音效
    await customSwatch.vm.$emit('commit', '#FF5500')
    expect(soundSpy).toHaveBeenCalledWith('select')
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

  it('接龙作画时在工具条末尾提交，已提交后按钮锁定并显示等待状态', async () => {
    const wrapper = mountToolbar({ showRelaySubmit: true })
    const submit = wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.game.relayDrawingSubmit))
    if (!submit) throw new Error('接龙作画提交按钮未渲染')

    await submit.trigger('click')
    expect(wrapper.emitted('relay-submit')).toHaveLength(1)

    await wrapper.setProps({ relaySubmitted: true })
    const waiting = wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.game.relayWaitingOthers))
    expect(waiting?.element.disabled).toBe(true)
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

  it('拖动手柄可移动工具条位置并在工作区内夹取', async () => {
    const wrapper = mountToolbar()
    const toolbar = wrapper.element as HTMLElement
    const workspace = document.createElement('div')
    workspace.appendChild(toolbar)

    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        toJSON: () => ({}),
      }) as DOMRect

    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 500))
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(rect(200, 400, 600, 50))

    const handle = wrapper.get(`[aria-label="${strings.a11y.game.dragToolbarAria}"]`)
      .element as HTMLElement

    handle.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 200,
        clientY: 400,
        pointerId: 1,
      }),
    )
    handle.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        button: 0,
        clientX: 300,
        clientY: 300,
        pointerId: 1,
      }),
    )

    const emitted = wrapper.emitted('update:position') as Array<[{ x: number; y: number }]>
    expect(emitted).toBeTruthy()
    expect(emitted[0]?.[0]).toEqual({ x: 20, y: 80 })
    expect(emitted[1]?.[0]).toEqual({ x: 30, y: 60 })

    handle.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        clientX: 300,
        clientY: 300,
        pointerId: 1,
      }),
    )
    wrapper.unmount()
  })
})
