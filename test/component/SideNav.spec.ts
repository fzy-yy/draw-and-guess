import { defineComponent, markRaw } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { playInteractionSound } from '@/audio'
import SideNav from '@/components/common/SideNav.vue'

const TestIcon = markRaw(defineComponent({ template: '<span aria-hidden="true"></span>' }))

describe('SideNav 受控导航', () => {
  it('标记当前页面，并通过 v-model 切换目标页', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    render(SideNav, {
      props: {
        items: [
          { key: 'audio', label: '声音', icon: TestIcon },
          { key: 'shortcuts', label: '快捷键', icon: TestIcon },
        ],
        label: '设置分类',
        modelValue: 'audio',
        'onUpdate:modelValue': onUpdate,
      },
    })

    expect(screen.getByRole('button', { name: '声音' }).getAttribute('aria-current')).toBe('page')
    await user.click(screen.getByRole('button', { name: '快捷键' }))

    expect(onUpdate).toHaveBeenCalledWith('shortcuts')
    expect(playInteractionSound).toHaveBeenCalledWith('select')
  })
})
