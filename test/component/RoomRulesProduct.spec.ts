import { setActivePinia, type Pinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROOM_PRESETS, applyRoomPreset, createRoomSettings } from '@draw-guess/config'
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

describe('房间规则预设与高级设置', () => {
  it('创建 UI 选择竞速预设后提交完整映射，同时保留独立容量', async () => {
    const store = useGameStore()
    const createRoom = vi.spyOn(store, 'createRoom').mockResolvedValue(true)
    const wrapper = mount(CreateRoomDialog, {
      props: { open: true },
      global: { plugins: [pinia] },
    })

    const selects = wrapper.findAll('select')
    await selects[0]!.setValue('4')
    await selects[1]!.setValue('speed')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.lobby.createAndEnter))!
      .trigger('click')
    await flushPromises()

    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { maxPlayers: 4, ...ROOM_PRESETS.speed } }),
    )
    wrapper.unmount()
  })

  it('编辑 UI 可应用预设，并让全部高级规则拥有可操作入口', async () => {
    const draft = createRoomSettings('standard', 6)
    const wrapper = mount(RulesDialog, {
      props: { open: true, draft },
      global: { plugins: [pinia] },
    })

    expect(wrapper.text()).toContain(strings.room.advancedSettings)
    expect(wrapper.text()).toContain(strings.room.drawFallbackField)
    expect(wrapper.text()).toContain(strings.room.toggleShowWordLength)
    expect(wrapper.text()).toContain(strings.room.toggleProgressiveHints)
    expect(wrapper.text()).toContain(strings.room.toggleStructuredHints)
    expect(wrapper.text()).toContain(strings.room.hintStartRatioField)
    expect(wrapper.text()).toContain(strings.room.guessBaseScoreField)
    expect(wrapper.text()).toContain(strings.room.scoreModeField)
    expect(wrapper.text()).toContain(strings.room.togglePause)
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(6)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(6)

    await wrapper.findAll('select')[0]!.setValue('relaxed')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.room.saveRules))!
      .trigger('click')
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual(applyRoomPreset(draft, 'relaxed'))
    wrapper.unmount()
  })

  it('摘要始终显示预设、容量、轮数与回退时长，只追加偏离预设的字段', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture('waiting')
    roomStore.room.settings = createRoomSettings('standard', 6)
    session.playerId = HOST_ID
    const wrapper = mount(RuleSummary, {
      props: { vocabularyLoading: false },
      global: { plugins: [pinia] },
    })

    expect(wrapper.text()).toContain(strings.room.presetStandard)
    expect(wrapper.text()).toContain(strings.room.ruleDrawFallback(90))
    expect(wrapper.text()).not.toContain(strings.room.ruleOptionsDt)

    roomStore.room.settings.optionCount = 5
    await flushPromises()
    expect(wrapper.text()).toContain(strings.room.presetCustomized(strings.room.presetStandard))
    expect(wrapper.text()).toContain(strings.room.ruleOptionsDd(5))
    wrapper.unmount()
  })
})
