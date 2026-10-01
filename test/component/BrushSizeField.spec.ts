import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import BrushSizeField from '@/components/game/BrushSizeField.vue'

/**
 * 画笔大小控件的对外行为：只显示数值、滚轮调值并夹取区间、悬停显示与粗细同直径的画笔圆点、
 * 禁用时不响应滚轮与悬停。只断言可见结果与事件，不锁内部状态。
 */

const SIZE = APP_CONFIG.drawing.width

function mountField(
  props: Partial<{ modelValue: number; disabled: boolean; color: string }> = {},
): VueWrapper {
  return mount(BrushSizeField, {
    props: { modelValue: 8, ...props },
  })
}

function wheel(wrapper: VueWrapper, deltaY: number): void {
  wrapper
    .get('div')
    .element.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))
}

describe('BrushSizeField', () => {
  it('显示当前粗细数值与单位', () => {
    const wrapper = mountField({ modelValue: 12 })
    expect(wrapper.text()).toContain('12')
    expect(wrapper.text()).toContain(strings.game.brushUnit)
    wrapper.unmount()
  })

  it('滚轮上滚加一步、下滚减一步并经 v-model 上抛', () => {
    const up = mountField({ modelValue: 8 })
    wheel(up, -1)
    expect(up.emitted('update:modelValue')?.[0]).toEqual([8 + SIZE.wheelStep])
    up.unmount()

    const down = mountField({ modelValue: 8 })
    wheel(down, 1)
    expect(down.emitted('update:modelValue')?.[0]).toEqual([8 - SIZE.wheelStep])
    down.unmount()
  })

  it('滚轮调值不再越出协议区间', () => {
    // 已在最细：继续下滚不产生新的更小值
    const atMin = mountField({ modelValue: SIZE.min })
    wheel(atMin, 1)
    expect(atMin.emitted('update:modelValue')).toBeUndefined()
    atMin.unmount()

    // 次细：下滚正好落到下限
    const nearMin = mountField({ modelValue: SIZE.min + SIZE.wheelStep })
    wheel(nearMin, 1)
    expect(nearMin.emitted('update:modelValue')?.[0]).toEqual([SIZE.min])
    nearMin.unmount()

    // 已在最粗：继续上滚不产生新的更大值
    const atMax = mountField({ modelValue: SIZE.max })
    wheel(atMax, -1)
    expect(atMax.emitted('update:modelValue')).toBeUndefined()
    atMax.unmount()

    // 次粗：上滚正好落到上限
    const nearMax = mountField({ modelValue: SIZE.max - SIZE.wheelStep })
    wheel(nearMax, -1)
    expect(nearMax.emitted('update:modelValue')?.[0]).toEqual([SIZE.max])
    nearMax.unmount()
  })

  it('悬停时显示与当前粗细同直径的画笔圆点，移出即隐藏', async () => {
    const wrapper = mountField({ modelValue: 16 })

    await wrapper.get('div').trigger('pointerenter')
    const dot = wrapper.find('span[aria-hidden="true"]')
    expect(dot.exists()).toBe(true)
    expect(dot.attributes('style')).toContain('width: 16px')
    expect(dot.attributes('style')).toContain('height: 16px')

    await wrapper.get('div').trigger('pointerleave')
    expect(wrapper.find('span[aria-hidden="true"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('禁用时不响应滚轮也不显示圆点', async () => {
    const wrapper = mountField({ modelValue: 8, disabled: true })

    wheel(wrapper, -1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await wrapper.get('div').trigger('pointerenter')
    expect(wrapper.find('span[aria-hidden="true"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
