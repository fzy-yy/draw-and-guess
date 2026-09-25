import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { playInteractionSound } from '@/audio'
import RuleSelectField from '@/components/common/RuleSelectField.vue'
import RuleSliderField from '@/components/common/RuleSliderField.vue'
import RuleToggleField from '@/components/common/RuleToggleField.vue'

describe('规则字段原语', () => {
  it('下拉选择保留值类型并发送选择反馈', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    render(RuleSelectField, {
      props: {
        label: '最大人数',
        modelValue: 2,
        options: [
          { value: 2, label: '两人' },
          { value: 4, label: '四人' },
        ],
        'onUpdate:modelValue': onUpdate,
      },
    })

    // 手写 SelectDropdown（替代原生 select）：点 combobox 展开 → 点 option 选中，值保持数字语义
    await user.click(screen.getByRole('combobox', { name: '最大人数' }))
    await user.click(await screen.findByRole('option', { name: '四人' }))

    expect(onUpdate).toHaveBeenLastCalledWith(4)
    expect(playInteractionSound).toHaveBeenCalledWith('select')
  })

  it('布尔开关更新模型并发送切换反馈', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    render(RuleToggleField, {
      props: {
        label: '允许暂停',
        modelValue: false,
        'onUpdate:modelValue': onUpdate,
      },
    })

    await user.click(screen.getByRole('checkbox'))

    expect(onUpdate).toHaveBeenCalledWith(true)
    expect(playInteractionSound).toHaveBeenCalledWith('toggle')
  })

  it('滑块输入即时更新，提交变化时只播放一次反馈', async () => {
    const onUpdate = vi.fn()
    render(RuleSliderField, {
      props: {
        display: '60 秒',
        label: '作画时间',
        max: 120,
        min: 30,
        modelValue: 60,
        step: 10,
        'onUpdate:modelValue': onUpdate,
      },
    })
    const slider = screen.getByRole('slider')

    await fireEvent.input(slider, { target: { value: '90' } })
    await fireEvent.change(slider)

    expect(onUpdate).toHaveBeenLastCalledWith(90)
    expect(playInteractionSound).toHaveBeenCalledOnce()
    expect(playInteractionSound).toHaveBeenCalledWith('select')
  })
})
