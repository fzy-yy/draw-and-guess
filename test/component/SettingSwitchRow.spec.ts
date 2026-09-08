import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { playInteractionSound } from '@/audio'
import SettingSwitchRow from '@/components/common/SettingSwitchRow.vue'

describe('SettingSwitchRow 双向绑定', () => {
  it('切换时同时更新模型、请求保存并发送统一音效意图', async () => {
    const wrapper = mount(SettingSwitchRow, {
      props: {
        modelValue: false,
        title: '允许邀请',
        hint: '允许其他玩家发送邀请',
      },
    })

    await wrapper.get('input').setValue(true)
    await nextTick()

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(playInteractionSound).toHaveBeenCalledWith('toggle')
    wrapper.unmount()
  })
})
