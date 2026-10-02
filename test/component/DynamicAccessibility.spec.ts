import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { run as runAxe } from 'axe-core'
import { strings } from '@draw-guess/strings'
import ActionBanner from '@/components/common/ActionBanner.vue'
import ActionPopover from '@/components/common/ActionPopover.vue'
import AppToaster from '@/components/common/AppToaster.vue'
import SearchInput from '@/components/common/SearchInput.vue'
import { dismiss, notify, useToasts } from '@/composables/useToasts'

afterEach(() => {
  for (const toast of [...useToasts().toasts]) dismiss(toast.id)
})

describe('动态 UI 无障碍语义', () => {
  it('Toast 按严重级别选择单一 live role，并提供真实关闭按钮', async () => {
    const user = userEvent.setup()
    notify('保存成功', 'success')
    notify('连接较慢', 'warning')
    notify('保存失败', 'error')
    const { container } = render(AppToaster)

    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(screen.getByRole('alert').textContent).toBe('保存失败')
    expect(container.firstElementChild?.hasAttribute('aria-live')).toBe(false)

    const close = screen.getByRole('button', {
      name: strings.a11y.common.dismissToastAria('保存成功'),
    })
    close.focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByText('保存成功')).toBeNull()
  })

  it('ActionBanner 作为非模态 region 出现时不抢焦点，关闭后恢复横幅外焦点', async () => {
    const user = userEvent.setup()
    const outside = document.createElement('button')
    outside.textContent = '原操作'
    document.body.append(outside)
    outside.focus()
    const view = render(ActionBanner, {
      props: { open: false, ariaLabel: '房间邀请', message: '加入房间吗？' },
      slots: { actions: '<button type="button">接受</button>' },
    })

    await view.rerender({ open: true, ariaLabel: '房间邀请', message: '加入房间吗？' })
    expect(screen.getByRole('region', { name: '房间邀请' })).toBeTruthy()
    expect(document.activeElement).toBe(outside)

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '接受' }))
    await view.rerender({ open: false, ariaLabel: '房间邀请', message: '加入房间吗？' })
    await waitFor(() => expect(document.activeElement).toBe(outside))
    outside.remove()
  })

  it('ActionPopover 用键盘打开后聚焦首项，Esc 关闭并返回触发器', async () => {
    const user = userEvent.setup()
    render(ActionPopover, {
      props: { triggerLabel: '打开互动', panelAriaLabel: '互动选项' },
      slots: {
        trigger: '<span aria-hidden="true">+</span>',
        default: '<button type="button">发送表情</button>',
      },
    })
    const trigger = screen.getByRole('button', { name: '打开互动' })
    trigger.focus()

    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: '互动选项' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-controls')).toBe(dialog.id)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '发送表情' }))

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('SearchInput 的本地化清除按钮支持纯键盘清空', async () => {
    const user = userEvent.setup()
    const view = render(SearchInput, {
      props: { modelValue: '房间', ariaLabel: '搜索房间' },
    })
    const input = screen.getByRole('textbox', { name: '搜索房间' })
    input.focus()

    await user.tab()
    const clear = screen.getByRole('button', { name: strings.a11y.common.clearSearchAria })
    expect(document.activeElement).toBe(clear)
    await user.keyboard('{Enter}')

    expect(view.emitted()['update:modelValue']).toContainEqual([''])
  })

  it('动态通用组件通过 axe 扫描', async () => {
    notify('操作完成', 'success')
    const toaster = render(AppToaster)
    expect((await runAxe(toaster.container)).violations).toEqual([])
    toaster.unmount()

    const popover = render(ActionPopover, {
      props: { triggerLabel: '筛选', panelAriaLabel: '筛选选项' },
      slots: { default: '<button type="button">全部</button>' },
    })
    await userEvent.setup().click(screen.getByRole('button', { name: '筛选' }))
    expect((await runAxe(popover.container)).violations).toEqual([])
  })
})
