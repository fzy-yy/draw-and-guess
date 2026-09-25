import { setActivePinia, type Pinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRoomSettings } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import CreateRoomDialog from '@/components/lobby/CreateRoomDialog.vue'
import RuleSummary from '@/components/room/RuleSummary.vue'
import RulesDialog from '@/components/room/RulesDialog.vue'
import { useGameStore } from '@/stores/game'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { HOST_ID, createRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'

let pinia: Pinia

beforeEach(() => {
  pinia = createPiniaWithFakeTransport().pinia
  setActivePinia(pinia)
})

/**
 * 房间规则产品（旧「玩法预设」与「计分方式」已移除）：
 * 建房提交唯一默认组、规则弹窗字段完整（含新增「额外猜词时间」滑块）、
 * 摘要按「默认组差异」裁剪展示。
 */
describe('房间规则与高级设置', () => {
  it('创建 UI 仅设置容量，提交完整默认规则组', async () => {
    const store = useGameStore()
    const createRoom = vi.spyOn(store, 'createRoom').mockResolvedValue(true)
    const wrapper = mount(CreateRoomDialog, {
      props: { open: true },
      global: { plugins: [pinia] },
    })

    // 建房弹窗只剩一个下拉（最大人数，手写 SelectDropdown）；玩法预设已删除
    const dropdowns = wrapper.findAll('button[aria-haspopup="listbox"]')
    expect(dropdowns).toHaveLength(1)
    await dropdowns[0]!.trigger('click')
    await wrapper
      .findAll('[role="option"]')
      .find((option) => option.text().includes('4 人'))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.lobby.createAndEnter))!
      .trigger('click')
    await flushPromises()

    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ settings: defaultRoomSettings(4) }),
    )
    wrapper.unmount()
  })

  it('编辑 UI 覆盖全部规则字段（含额外猜词时间），保存原样上抛草稿', async () => {
    const draft = defaultRoomSettings(6)
    const wrapper = mount(RulesDialog, {
      props: { open: true, draft },
      global: { plugins: [pinia] },
    })

    // 收纳结构：基础设置 + 高级设置；计分方式与玩法预设均不再出现
    expect(wrapper.text()).toContain(strings.room.basicSettings)
    expect(wrapper.text()).toContain(strings.room.advancedSettings)
    expect(wrapper.text()).not.toContain('玩法预设')
    expect(wrapper.text()).not.toContain('计分方式')
    expect(wrapper.text()).toContain(strings.room.drawFallbackField)
    expect(wrapper.text()).toContain(strings.room.extraGuessSecondsField)
    expect(wrapper.text()).toContain(strings.room.toggleShowWordLength)
    expect(wrapper.text()).toContain(strings.room.toggleProgressiveHints)
    expect(wrapper.text()).toContain(strings.room.toggleStructuredHints)
    expect(wrapper.text()).toContain(strings.room.hintStartRatioField)
    expect(wrapper.text()).toContain(strings.room.guessBaseScoreField)
    expect(wrapper.text()).toContain(strings.room.togglePause)
    // 滑块：轮数/选词时间/候选数 + 回退时长/额外时间/提示时机/基础分 = 7；开关 6
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(7)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(6)

    // 额外猜词时间滑块区间：0~90、步进 5（来自配置，改上限只需改协议常量）；全场唯一 min=0 的滑块
    const extraSlider = wrapper
      .findAll('input[type="range"]')
      .find((input) => input.attributes('min') === '0')!
    expect(extraSlider.attributes('max')).toBe('90')
    expect(extraSlider.attributes('step')).toBe('5')

    await wrapper.get('button[aria-haspopup="listbox"]').trigger('click')
    await wrapper
      .findAll('[role="option"]')
      .find((option) => option.text().includes('4 人'))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.room.saveRules))!
      .trigger('click')
    const saved = wrapper.emitted('save')?.[0]?.[0]
    expect(saved).toEqual({ ...draft, maxPlayers: 4 })
    wrapper.unmount()
  })

  it('摘要始终显示容量、轮数与回退时长，只追加偏离默认组的字段与额外时间', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture('waiting')
    roomStore.room.settings = defaultRoomSettings(6)
    session.playerId = HOST_ID
    const wrapper = mount(RuleSummary, {
      props: { vocabularyLoading: false },
      global: { plugins: [pinia] },
    })

    expect(wrapper.text()).toContain(strings.room.ruleDrawFallback(90))
    expect(wrapper.text()).not.toContain(strings.room.ruleOptionsDt)
    // 额外时间为 0 时不展示
    expect(wrapper.text()).not.toContain(strings.room.extraGuessSecondsField)

    roomStore.room.settings.optionCount = 5
    roomStore.room.settings.extraGuessSeconds = 30
    await flushPromises()
    expect(wrapper.text()).toContain(strings.room.ruleOptionsDd(5))
    expect(wrapper.text()).toContain(strings.room.extraGuessSecondsValue(30))
    wrapper.unmount()
  })
})
