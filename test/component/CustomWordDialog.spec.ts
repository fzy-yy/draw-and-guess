import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { strings } from '@draw-guess/strings'
import CustomWordDialog from '@/components/game/CustomWordDialog.vue'

describe('CustomWordDialog 自定义词弹窗', () => {
  it('正确展示最多 12 个字提示，并在输入后允许开始作画', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(CustomWordDialog, {
      props: {
        open: true,
        submitting: false,
        onConfirm,
      },
    })

    expect(screen.getByText(strings.ui.game.customWordTooLong(12))).toBeTruthy()
    const input = screen.getByRole('textbox', { name: strings.a11y.game.customWordTitle })
    expect(input.getAttribute('maxlength')).toBe('12')

    const submitBtn = screen.getByRole('button', { name: strings.ui.game.customWordConfirm })
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true)

    await user.type(input, '一只在屋顶的猫')
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false)

    await user.click(submitBtn)
    expect(onConfirm).toHaveBeenCalledWith('一只在屋顶的猫')
  })

  it('输入达到 12 个字上限时直接截断，杜绝超出后无法提交', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(CustomWordDialog, {
      props: {
        open: true,
        submitting: false,
        onConfirm,
      },
    })

    const input = screen.getByRole('textbox', { name: strings.a11y.game.customWordTitle })
    // 输入 15 个字
    await user.type(input, '一二三四五六七八九十一二三四五')

    // 截断为 12 个字
    expect((input as HTMLInputElement).value).toBe('一二三四五六七八九十一二')
    const submitBtn = screen.getByRole('button', { name: strings.ui.game.customWordConfirm })
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false)

    await user.click(submitBtn)
    expect(onConfirm).toHaveBeenCalledWith('一二三四五六七八九十一二')
  })
})
