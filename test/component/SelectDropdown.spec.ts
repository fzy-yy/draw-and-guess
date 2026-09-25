import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SelectDropdown, { type SelectDropdownOption } from '@/components/common/SelectDropdown.vue'

const options: SelectDropdownOption<string>[] = [
  { value: 'a', label: '选项甲' },
  { value: 'b', label: '选项乙' },
  { value: 'c', label: '选项丙' },
]

/**
 * 手写下拉选择原语验收：展开/选中回写、键盘导航（回绕/Enter/Esc 阻断冒泡）、
 * 点外关闭与禁用态。Esc 不冒泡是「弹窗内下拉关闭不连带关弹窗」的关键契约。
 * 展开面板为 fixed 视口锚定（见 docs/adr/0015）：断言定位样式与「祖先滚动即关闭、
 * 面板自身滚动不关闭」的行为边界。
 */
function factory(props: Record<string, unknown> = {}) {
  return mount(SelectDropdown, {
    props: { modelValue: 'a', options, ...props },
    attachTo: document.body,
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SelectDropdown 手写下拉组件', () => {
  it('收起态显示当前选中项，点击展开 listbox 并标记选中', async () => {
    const wrapper = factory()
    const button = wrapper.get('button')
    expect(button.text()).toContain('选项甲')
    expect(button.attributes('aria-expanded')).toBe('false')

    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('true')
    const items = wrapper.findAll('[role="option"]')
    expect(items).toHaveLength(3)
    expect(items[0]!.attributes('aria-selected')).toBe('true')
    expect(items[1]!.attributes('aria-selected')).toBe('false')
    wrapper.unmount()
  })

  it('点击选项回写 v-model 并收起面板', async () => {
    const wrapper = factory()
    await wrapper.get('button').trigger('click')
    await wrapper.findAll('[role="option"]')[1]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['b'])
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('键盘导航：ArrowDown 打开、ArrowUp 回绕、Enter 选中高亮项', async () => {
    const wrapper = factory()
    const button = wrapper.get('button')

    await button.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    // 初始高亮当前选中项（index 0）；ArrowUp 回绕到末项
    await button.trigger('keydown', { key: 'ArrowUp' })
    expect(button.attributes('aria-activedescendant')).toBe(
      wrapper.findAll('[role="option"]')[2]!.attributes('id'),
    )
    await button.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['c'])
    wrapper.unmount()
  })

  it('Esc 只关闭下拉，不冒泡到 document（避免连带关闭宿主弹窗）', async () => {
    const documentSpy = vi.fn()
    document.addEventListener('keydown', documentSpy)
    const wrapper = factory()
    const button = wrapper.get('button')

    await button.trigger('click')
    await button.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(documentSpy).not.toHaveBeenCalled()
    document.removeEventListener('keydown', documentSpy)
    wrapper.unmount()
  })

  it('面板外 pointerdown 关闭下拉；面板内点击不触发外部关闭', async () => {
    const wrapper = factory()
    await wrapper.get('button').trigger('click')
    // 面板内部元素上的 pointerdown 不应关闭（真实事件冒泡到 document 后按包含关系判定）
    wrapper
      .get('[role="listbox"]')
      .element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    // 面板外部（body）的 pointerdown 关闭
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('禁用态不响应点击，不展开面板', async () => {
    const wrapper = factory({ disabled: true })
    const button = wrapper.get('button')
    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('展开面板为 fixed 视口锚定（内联 position/left/width，见 docs/adr/0015）', async () => {
    const wrapper = factory()
    await wrapper.get('button').trigger('click')
    const list = wrapper.get('[role="listbox"]').element as HTMLElement
    expect(list.style.position).toBe('fixed')
    // 锚定坐标由 getBoundingClientRect 计算并内联写入（happy-dom 下为 0px，仍应存在）
    expect(list.style.left).toMatch(/px$/)
    expect(list.style.width).toMatch(/px$/)
    wrapper.unmount()
  })

  it('祖先滚动容器滚动即关闭；面板自身选项滚动不关闭', async () => {
    const wrapper = factory()
    await wrapper.get('button').trigger('click')
    const list = wrapper.get('[role="listbox"]').element as HTMLElement

    // 面板自身 overflow 滚动：目标在 listbox 内，保持展开
    list.dispatchEvent(new Event('scroll', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)

    // 宿主表单区（面板外元素）滚动：脱节即关闭
    document.body.dispatchEvent(new Event('scroll', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
