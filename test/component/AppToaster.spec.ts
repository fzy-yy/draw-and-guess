import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { strings } from '@draw-guess/strings'
import AppToaster from '@/components/common/AppToaster.vue'
import { dismiss, notify, useToasts } from '@/composables/useToasts'

afterEach(() => {
  for (const toast of [...useToasts().toasts]) dismiss(toast.id)
})

describe('AppToaster 键盘关闭', () => {
  it('关闭按钮具有通知上下文名称，并可通过 Enter 键移除对应提示', async () => {
    const user = userEvent.setup()
    render(AppToaster)
    notify('网络连接不稳定', 'error')

    expect((await screen.findByRole('alert')).textContent).toContain('网络连接不稳定')
    const close = screen.getByRole('button', {
      name: strings.a11y.common.dismissToastAria('网络连接不稳定'),
    })
    close.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(useToasts().toasts).toHaveLength(0)
  })

  it('多个提示各自保留可辨识的关闭名称，空格键只关闭当前项', async () => {
    const user = userEvent.setup()
    render(AppToaster)
    notify('规则已保存')
    notify('等待其他玩家', 'warning')

    const firstClose = await screen.findByRole('button', {
      name: strings.a11y.common.dismissToastAria('规则已保存'),
    })
    firstClose.focus()
    await user.keyboard(' ')

    await waitFor(() => expect(screen.queryByText('规则已保存')).toBeNull())
    expect(screen.getByText('等待其他玩家')).toBeTruthy()
  })
})
