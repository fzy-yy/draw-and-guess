import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import AppInput from '@/components/common/AppInput.vue'

describe('AppInput 用户输入', () => {
  it('按真实输入顺序更新值，并在 Enter 时上抛键盘事件', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onEnter = vi.fn()
    render(AppInput, {
      props: {
        ariaLabel: '玩家昵称',
        modelValue: '',
        'onUpdate:modelValue': onUpdate,
        onEnter,
      },
    })

    const input = screen.getByRole('textbox', { name: '玩家昵称' })
    await user.type(input, '画手{Enter}')

    expect(onUpdate).toHaveBeenLastCalledWith('画手')
    expect(onEnter).toHaveBeenCalledOnce()
  })

  it('禁用时拒绝输入和 Enter 操作', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onEnter = vi.fn()
    render(AppInput, {
      props: {
        ariaLabel: '房间码',
        disabled: true,
        modelValue: '',
        'onUpdate:modelValue': onUpdate,
        onEnter,
      },
    })

    await user.type(screen.getByRole('textbox', { name: '房间码' }), 'ABC123{Enter}')

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onEnter).not.toHaveBeenCalled()
  })
})
