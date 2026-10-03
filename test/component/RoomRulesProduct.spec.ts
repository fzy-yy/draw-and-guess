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
 * 建房提交唯一默认组、规则弹窗平铺全部字段（区间用下拉、开关用复选框）、
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
      .find((button) => button.text().includes(strings.ui.lobby.createAndEnter))!
      .trigger('click')
    await flushPromises()

    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ settings: defaultRoomSettings(4) }),
    )
    wrapper.unmount()
  })

  it('编辑 UI 覆盖全部规则字段（含单回合时长档位与选词时间），保存原样上抛草稿', async () => {
    const draft = defaultRoomSettings(6)
    const wrapper = mount(RulesDialog, {
      props: { open: true, draft },
      global: { plugins: [pinia] },
    })

    // 字段全部平铺（无「基础设置 / 高级设置」收纳）；计分方式与玩法预设均不再出现
    expect(wrapper.text()).not.toContain('玩法预设')
    expect(wrapper.text()).not.toContain('计分方式')
    expect(wrapper.text()).toContain(strings.ui.room.drawSecondsField)
    expect(wrapper.text()).toContain(strings.ui.room.toggleAllowCustomWord)
    expect(wrapper.text()).toContain(strings.ui.room.toggleShowWordLength)
    expect(wrapper.text()).toContain(strings.ui.room.toggleProgressiveHints)
    expect(wrapper.text()).toContain(strings.ui.room.togglePause)
    // 区间字段一律下拉：滑块 0；开关 9（原有 6 项 + 差一字提示 + 画布微表情互动 + 作画精彩重播）
    //（结构化提示、提示出现时机、额外猜词时间与猜词基础分均已移除）
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(0)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(9)
    // 下拉：最大玩家数 / 每人作画次数 / 单回合时长 / 选词时间 / 候选词数量 / 中途加入 = 6
    // 单回合时长默认显示 120 秒；选词阶段默认不限时
    expect(wrapper.findAll('button[aria-haspopup="listbox"]')).toHaveLength(6)
    expect(wrapper.text()).toContain(strings.ui.common.secondsUnit(draft.drawSeconds))
    expect(wrapper.text()).toContain(strings.ui.room.chooseTimeUnlimited)

    await wrapper.get('button[aria-haspopup="listbox"]').trigger('click')
    await wrapper
      .findAll('[role="option"]')
      .find((option) => option.text().includes('4 人'))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.room.saveRules))!
      .trigger('click')
    const saved = wrapper.emitted('save')?.[0]?.[0]
    expect(saved).toEqual({ ...draft, maxPlayers: 4 })
    wrapper.unmount()
  })

  it('「选词时间」合并下拉与两个协议字段往返一致，切回不限时保留已选秒数', async () => {
    const draft = defaultRoomSettings(6)
    const wrapper = mount(RulesDialog, {
      props: { open: true, draft },
      global: { plugins: [pinia] },
    })
    // 模板顺序固定：最大玩家数 / 每人作画次数 / 单回合时长 / 选词时间 / 候选词数量 / 中途加入
    const chooseTimeCombo = wrapper.findAll('button[aria-haspopup="listbox"]')[3]!
    const pick = async (label: string): Promise<void> => {
      await chooseTimeCombo.trigger('click')
      await wrapper
        .findAll('[role="option"]')
        .find((option) => option.text() === label)!
        .trigger('click')
    }

    // 默认不限时（allowChooseTimeLimit=false）→ 选具体秒数：开限时并写入 chooseSeconds
    await pick(strings.ui.common.secondsUnit(20))
    // 再选回不限时：只关开关，上次秒数保留（下次开限时沿用同一值）
    await pick(strings.ui.room.chooseTimeUnlimited)

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.room.saveRules))!
      .trigger('click')
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      ...draft,
      chooseSeconds: 20,
      allowChooseTimeLimit: false,
    })
    wrapper.unmount()
  })

  it('最大玩家数下拉剔除低于当前占席数的档位（与服务端校验同口径）', async () => {
    const fixture = createRoomFixture('waiting')
    const extra = [0, 1].map((index) => ({
      ...fixture.members[0]!,
      id: `00000000-0000-4000-8000-00000000001${index}`,
      nickname: `玩家${index}`,
      isHost: false,
    }))
    const roomStore = useRoomStore()
    roomStore.room = { ...fixture, members: [...fixture.members, ...extra] }
    const wrapper = mount(RulesDialog, {
      props: { open: true, draft: fixture.settings },
      global: { plugins: [pinia] },
    })

    // 占席 4 人：下限抬到 4（1~3 人可直接选到、只能被服务端拒绝的档位不再出现）
    await wrapper.findAll('button[aria-haspopup="listbox"]')[0]!.trigger('click')
    expect(wrapper.findAll('[role="option"]').map((option) => option.text())).toEqual(
      [4, 5, 6].map((count) => strings.ui.common.playersUnit(count)),
    )
    wrapper.unmount()
  })

  it('摘要始终显示容量、轮数、单回合时长与选词阶段状态，只追加偏离默认组的字段', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture('waiting')
    roomStore.room.settings = defaultRoomSettings(6)
    session.playerId = HOST_ID
    const wrapper = mount(RuleSummary, {
      props: { vocabularyLoading: false },
      global: { plugins: [pinia] },
    })

    expect(wrapper.text()).toContain(strings.ui.room.ruleDrawValue(120))
    // 选词阶段默认不限时：常驻展示，不依赖差异判定
    expect(wrapper.text()).toContain(strings.ui.room.chooseTimeUnlimited)
    expect(wrapper.text()).not.toContain(strings.ui.room.ruleOptionsDt)

    roomStore.room.settings.optionCount = 5
    roomStore.room.settings.allowChooseTimeLimit = true
    roomStore.room.settings.chooseSeconds = 25
    await flushPromises()
    expect(wrapper.text()).toContain(strings.ui.room.ruleOptionsDd(5))
    expect(wrapper.text()).toContain(strings.ui.common.secondsUnit(25))
    expect(wrapper.text()).not.toContain(strings.ui.room.chooseTimeUnlimited)
    wrapper.unmount()
  })

  it('邀请按钮的满员判定按占席口径：离局占位不会造成「假满员」', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture('waiting')
    roomStore.room.settings = { ...roomStore.room.settings, maxPlayers: 2 }
    session.playerId = HOST_ID
    const wrapper = mount(RuleSummary, {
      props: { vocabularyLoading: false },
      global: { plugins: [pinia] },
    })
    const inviteButton = (): { attributes: (name: string) => string | undefined } =>
      wrapper
        .findAll('button')
        .find((button) => button.text().includes(strings.ui.room.invitePlayers))!

    // 2 个成员里 1 人已离局：占席 1/2 未满，仍可邀请（离局占位只为成绩卡保留）
    roomStore.room.members[1]!.leftGame = true
    await flushPromises()
    expect(inviteButton().attributes('disabled')).toBeUndefined()
    expect(inviteButton().attributes('title')).toBe(strings.ui.room.inviteDisabledTip)

    // 全员在席才判满员：禁用并给出满员提示
    roomStore.room.members[1]!.leftGame = false
    await flushPromises()
    expect(inviteButton().attributes('disabled')).toBeDefined()
    expect(inviteButton().attributes('title')).toBe(strings.ui.room.inviteDisabledFull)
    wrapper.unmount()
  })

  it('RulesDialog 在 readOnly 模式下禁用所有输入控件且仅显示关闭按钮', async () => {
    const draft = defaultRoomSettings(6)
    const wrapper = mount(RulesDialog, {
      props: { open: true, draft, readOnly: true },
      global: { plugins: [pinia] },
    })

    // 下拉按钮全部带 disabled 属性
    const dropdowns = wrapper.findAll('button[aria-haspopup="listbox"]')
    for (const dropdown of dropdowns) {
      expect(dropdown.attributes('disabled')).toBeDefined()
    }

    // 复选框 input 全部带 disabled 属性
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    for (const checkbox of checkboxes) {
      expect(checkbox.attributes('disabled')).toBeDefined()
    }

    // 底部没有「保存规则」按钮，仅有「关闭」按钮
    expect(wrapper.text()).not.toContain(strings.ui.room.saveRules)
    expect(wrapper.text()).toContain(strings.ui.common.close)
    wrapper.unmount()
  })

  it('RuleSummary 在非房主视角下展示「查看」规则按钮', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture('waiting')
    // 设为非房主
    session.playerId = 'guest-player-id'
    const wrapper = mount(RuleSummary, {
      props: { vocabularyLoading: false },
      global: { plugins: [pinia] },
    })

    expect(wrapper.text()).toContain(strings.ui.room.rulesView)
    expect(wrapper.text()).not.toContain(strings.ui.room.rulesEdit)
    wrapper.unmount()
  })
})
