import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { playInteractionSound } from '@/audio'
import AppButton from '@/components/common/AppButton.vue'

describe('AppButton 交互契约', () => {
  it('以可访问名称触发点击，并使用默认激活音效', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(AppButton, {
      slots: { default: '进入房间' },
    })
    const button = screen.getByRole('button', { name: '进入房间' })
    button.addEventListener('click', onClick)

    await user.click(button)

    expect(onClick).toHaveBeenCalledOnce()
    expect(playInteractionSound).toHaveBeenCalledWith('activate')
  })

  it('支持覆盖或关闭交互音效，禁用态不产生任何操作', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const view = render(AppButton, {
      props: { audioFeedback: 'select' },
      slots: { default: '选择工具' },
    })
    const button = screen.getByRole('button', { name: '选择工具' })
    button.addEventListener('click', onClick)

    await user.click(button)
    expect(playInteractionSound).toHaveBeenLastCalledWith('select')

    await view.rerender({ audioFeedback: null })
    await user.click(button)
    expect(playInteractionSound).toHaveBeenCalledTimes(1)

    await view.rerender({ audioFeedback: 'activate', disabled: true })
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(playInteractionSound).toHaveBeenCalledTimes(1)
  })
})
