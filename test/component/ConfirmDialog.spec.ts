import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'

const dialogProps = {
  body: '操作后将无法恢复',
  cancelLabel: '取消',
  confirmLabel: '确认清除',
  open: true,
  title: '清除画板',
} as const

describe('ConfirmDialog 用户决策', () => {
  it('取消会关闭弹窗且只发送 cancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const onUpdate = vi.fn()
    render(ConfirmDialog, {
      props: {
        ...dialogProps,
        onCancel,
        onConfirm,
        'onUpdate:open': onUpdate,
      },
    })

    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(onUpdate).toHaveBeenCalledWith(false)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('确认会关闭弹窗且只发送 confirm', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const onUpdate = vi.fn()
    render(ConfirmDialog, {
      props: {
        ...dialogProps,
        onCancel,
        onConfirm,
        'onUpdate:open': onUpdate,
      },
    })

    await user.click(screen.getByRole('button', { name: '确认清除' }))

    expect(onUpdate).toHaveBeenCalledWith(false)
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
