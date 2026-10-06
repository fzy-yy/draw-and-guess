import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import AvatarPickerField from '@/components/common/AvatarPickerField.vue'

describe('AvatarPickerField 交互与契约测试', () => {
  it('正确渲染当前头像与提示文案，点击触发弹窗', async () => {
    const user = userEvent.setup()
    render(AvatarPickerField, {
      props: {
        modelValue: '01',
        label: '头像设置',
        actionText: '更换头像',
      },
    })

    expect(screen.getByText('头像设置')).toBeTruthy()
    expect(screen.getByText('更换头像')).toBeTruthy()

    const button = screen.getByRole('button', { name: /头像/ })
    await user.click(button)

    // 应该打开头像选择弹窗
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('处于禁用态时不响应点击打开弹窗', async () => {
    const user = userEvent.setup()
    render(AvatarPickerField, {
      props: {
        modelValue: '01',
        actionText: '头像',
        disabled: true,
      },
    })

    const button = screen.getByRole('button', { name: /头像/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    await user.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
