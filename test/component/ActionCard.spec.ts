import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { playInteractionSound } from '@/audio'
import ActionCard from '@/components/common/ActionCard.vue'

describe('ActionCard 交互与契约测试', () => {
  it('正确渲染标题、副标题与变体，并触发点击与默认激活音效', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(ActionCard, {
      props: {
        title: '创建公开房间',
        hint: '创建公开或私密画室',
        variant: 'primary',
      },
    })

    const button = screen.getByRole('button', { name: /创建公开房间/ })
    button.addEventListener('click', onClick)

    expect(screen.getByText('创建公开房间')).toBeTruthy()
    expect(screen.getByText('创建公开或私密画室')).toBeTruthy()

    await user.click(button)
    expect(onClick).toHaveBeenCalledOnce()
    expect(playInteractionSound).toHaveBeenCalledWith('activate')
  })

  it('支持 sky 变体与禁用态限制交互', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const view = render(ActionCard, {
      props: {
        title: '词库管理',
        hint: '已选 120 词',
        variant: 'sky',
        disabled: true,
      },
    })

    const button = screen.getByRole('button') as HTMLButtonElement
    button.addEventListener('click', onClick)

    expect(button.disabled).toBe(true)
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()

    await view.rerender({ disabled: false })
    expect(button.disabled).toBe(false)
    await user.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
