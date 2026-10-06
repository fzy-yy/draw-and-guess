import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import RadioCardGroup from '@/components/common/RadioCardGroup.vue'

describe('RadioCardGroup 交互与契约测试', () => {
  const options = [
    { value: 'classic', title: '经典模式', hint: '一轮一题，轮流作画' },
    { value: 'relay', title: '接龙模式', hint: '并行传话，全员开画' },
  ] as const

  it('正确渲染单选组与选项，支持点击切换选项', async () => {
    const user = userEvent.setup()
    render(RadioCardGroup, {
      props: {
        modelValue: 'classic',
        label: '玩法模式',
        options,
      },
    })

    expect(screen.getByText('玩法模式')).toBeTruthy()
    expect(screen.getByText('经典模式')).toBeTruthy()
    expect(screen.getByText('接龙模式')).toBeTruthy()

    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios[0]?.checked).toBe(true)
    expect(radios[1]?.checked).toBe(false)

    await user.click(radios[1]!)
    expect(radios[1]?.checked).toBe(true)
  })

  it('禁用态下选项 input 被正确禁用', () => {
    render(RadioCardGroup, {
      props: {
        modelValue: 'classic',
        options,
        disabled: true,
      },
    })

    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios[0]?.disabled).toBe(true)
    expect(radios[1]?.disabled).toBe(true)
  })
})
