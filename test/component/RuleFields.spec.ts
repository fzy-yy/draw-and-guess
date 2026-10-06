import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { playInteractionSound } from '@/audio'
import RuleSelectField from '@/components/common/RuleSelectField.vue'
import RuleToggleField from '@/components/common/RuleToggleField.vue'

describe('规则字段原语', () => {
  it('下拉选择保留值类型并发送选择反馈', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    render(RuleSelectField, {
      props: {
        label: '每人作画次数',
        modelValue: 2,
        options: [
          { value: 2, label: '两轮' },
          { value: 4, label: '四轮' },
        ],
        'onUpdate:modelValue': onUpdate,
      },
    })

    // 手写 SelectDropdown（替代原生 select）：点 combobox 展开 → 点 option 选中，值保持数字语义
    await user.click(screen.getByRole('combobox', { name: '每人作画次数' }))
    await user.click(await screen.findByRole('option', { name: '四轮' }))

    expect(onUpdate).toHaveBeenLastCalledWith(4)
    expect(playInteractionSound).toHaveBeenCalledWith('select')
  })

  it('布尔开关更新模型并发送切换反馈', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    render(RuleToggleField, {
      props: {
        label: '允许画布气泡互动',
        modelValue: false,
        'onUpdate:modelValue': onUpdate,
      },
    })

    await user.click(screen.getByRole('checkbox'))

    expect(onUpdate).toHaveBeenCalledWith(true)
    expect(playInteractionSound).toHaveBeenCalledWith('toggle')
  })
})
