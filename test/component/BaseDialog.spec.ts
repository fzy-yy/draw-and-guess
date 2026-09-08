import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { playInteractionSound } from '@/audio'
import BaseDialog from '@/components/common/BaseDialog.vue'

describe('BaseDialog 生命周期', () => {
  it('打开时建立对话框语义，关闭按钮同步模型并发送一次关闭事件', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onClose = vi.fn()
    render(BaseDialog, {
      props: {
        ariaLabel: '规则设置',
        closeAria: '关闭规则设置',
        open: true,
        'onUpdate:open': onUpdate,
        onClose,
      },
      slots: { default: '规则内容' },
    })

    expect(screen.getByRole('dialog', { name: '规则设置' })).toBeTruthy()
    expect(playInteractionSound).toHaveBeenCalledWith('open')

    await user.click(screen.getByRole('button', { name: '关闭规则设置' }))

    expect(onUpdate).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalledOnce()
    expect(playInteractionSound).toHaveBeenLastCalledWith('close')
  })
})
