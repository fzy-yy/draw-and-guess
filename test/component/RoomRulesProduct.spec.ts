import { setActivePinia, type Pinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRoomSettings } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { PLAYER_PROTOCOL_LIMITS } from '@draw-guess/shared'
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
 * 房间规则产品（旧「玩法预设」与「计分方式」已移除，容量与中途加入策略随观战/候场删除）：
 * 建房提交唯一默认组（容量固定为协议常量，弹窗无容量字段）、规则弹窗平铺全部行为字段
 *（区间用下拉、开关用复选框）、摘要按「默认组差异」裁剪展示。
 */
describe('房间规则与高级设置', () => {
  it('创建 UI 提交完整默认规则组（容量固定，弹窗不含容量字段）', async () => {
    const store = useGameStore()
    const createRoom = vi.spyOn(store, 'createRoom').mockResolvedValue(true)
    const wrapper = mount(CreateRoomDialog, {
      props: { open: true },
      global: { plugins: [pinia] },
    })

    // 容量固定为协议常量：建房弹窗不再有「最大人数」下拉（玩法预设早已删除）
    expect(wrapper.findAll('button[aria-haspopup="listbox"]')).toHaveLength(0)
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.lobby.createAndEnter))!
      .trigger('click')
    await flushPromises()

    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ settings: defaultRoomSettings() }),
    )
    wrapper.unmount()
  })

  it('编辑 UI 覆盖全部规则字段（含单回合时长档位与选词时间），保存原样上抛草稿', async () => {
    const draft = defaultRoomSettings()
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
    // 区间字段一律下拉：滑块 0；开关 9（原有 6 项 + 差一字提示 + 画布微表情互动 + 作画精彩重播）
    //（结构化提示、提示出现时机、额外猜词时间与猜词基础分均已移除）
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(8)
    // 下拉：每人作画次数 / 单回合时长 / 选词时间 / 候选词数量 = 4
    //（容量与中途加入策略随观战/候场删除，不再是规则字段）
    expect(wrapper.findAll('button[aria-haspopup="listbox"]')).toHaveLength(4)
    expect(wrapper.text()).toContain(strings.ui.common.secondsUnit(draft.chooseSeconds))

    await wrapper.get('button[aria-haspopup="listbox"]').trigger('click')
    await wrapper
      .findAll('[role="option"]')
      .find((option) => option.text() === strings.ui.common.roundsUnit(3))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.room.saveRules))!
      .trigger('click')
    const saved = wrapper.emitted('save')?.[0]?.[0]
    expect(saved).toEqual({ ...draft, roundsPerPlayer: 3 })
    wrapper.unmount()
  })

  it('「选词时间」下拉修改秒数并正确保存到草稿', async () => {
    const draft = defaultRoomSettings()
    const wrapper = mount(RulesDialog, {
      props: { open: true, draft },
      global: { plugins: [pinia] },
    })
    // 模板顺序固定：每人作画次数 / 单回合时长 / 选词时间 / 候选词数量
    const chooseTimeCombo = wrapper.findAll('button[aria-haspopup="listbox"]')[2]!
    const pick = async (label: string): Promise<void> => {
      await chooseTimeCombo.trigger('click')
      await wrapper
        .findAll('[role="option"]')
        .find((option) => option.text() === label)!
        .trigger('click')
    }

    await pick(strings.ui.common.secondsUnit(20))

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes(strings.ui.room.saveRules))!
      .trigger('click')
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      ...draft,
      chooseSeconds: 20,
    })
    wrapper.unmount()
  })

  it('规则弹窗不再暴露容量档位（容量固定为协议常量）', async () => {
    const fixture = createRoomFixture('waiting')
    const roomStore = useRoomStore()
    roomStore.room = fixture
    const wrapper = mount(RulesDialog, {
      props: { open: true, draft: fixture.settings },
      global: { plugins: [pinia] },
    })

    // 四行下拉全部是行为规则；逐行展开确认没有任何「N 人」容量档位
    const dropdowns = wrapper.findAll('button[aria-haspopup="listbox"]')
    expect(dropdowns).toHaveLength(4)
    for (const dropdown of dropdowns) {
      await dropdown.trigger('click')
      const optionTexts = wrapper.findAll('[role="option"]').map((option) => option.text())
      for (const text of optionTexts) expect(text).not.toMatch(/^\d+ 人$/u)
      await dropdown.trigger('click') // 收起，避免影响下一次展开
    }
    wrapper.unmount()
  })

  it('摘要始终显示轮数、单回合时长与选词阶段状态，只追加偏离默认组的字段', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture('waiting')
    roomStore.room.settings = defaultRoomSettings()
    session.playerId = HOST_ID
    const wrapper = mount(RuleSummary, {
      props: { vocabularyLoading: false },
      global: { plugins: [pinia] },
    })

    expect(wrapper.text()).toContain(strings.ui.room.ruleDrawValue(120))
    expect(wrapper.text()).toContain(strings.ui.common.secondsUnit(15))
    expect(wrapper.text()).not.toContain(strings.ui.room.ruleOptionsDt)

    roomStore.room.settings.optionCount = 5
    roomStore.room.settings.chooseSeconds = 25
    await flushPromises()
    expect(wrapper.text()).toContain(strings.ui.room.ruleOptionsDd(5))
    expect(wrapper.text()).toContain(strings.ui.common.secondsUnit(25))
    wrapper.unmount()
  })

  it('邀请按钮的满员判定按占席口径与协议常量容量：离局占位不会造成「假满员」', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    const fixture = createRoomFixture('waiting')
    // 容量固定为协议常量：补齐到 maxPlayers 才算满员（房主 + 5 名加入者）
    const extra = Array.from(
      { length: PLAYER_PROTOCOL_LIMITS.maxPlayers - fixture.members.length },
      (_item, index) => ({
        ...fixture.members[0]!,
        id: `00000000-0000-4000-8000-00000000001${index}`,
        nickname: `玩家${index}`,
        isHost: false,
      }),
    )
    roomStore.room = { ...fixture, members: [...fixture.members, ...extra] }
    session.playerId = HOST_ID
    const wrapper = mount(RuleSummary, {
      props: { vocabularyLoading: false },
      global: { plugins: [pinia] },
    })
    const inviteButton = (): { attributes: (name: string) => string | undefined } =>
      wrapper
        .findAll('button')
        .find((button) => button.text().includes(strings.ui.room.invitePlayers))!

    // 满员 6 人：禁用并给出满员提示
    await flushPromises()
    expect(inviteButton().attributes('disabled')).toBeDefined()
    expect(inviteButton().attributes('title')).toBe(strings.ui.room.inviteDisabledFull)

    // 其中 1 人已离局：占席 5/6 未满，仍可邀请（离局占位只为成绩卡保留）
    roomStore.room.members[1]!.leftGame = true
    await flushPromises()
    expect(inviteButton().attributes('disabled')).toBeUndefined()
    expect(inviteButton().attributes('title')).toBe(strings.ui.room.inviteDisabledTip)
    wrapper.unmount()
  })

  it('RulesDialog 在 readOnly 模式下禁用所有输入控件且仅显示关闭按钮', async () => {
    const draft = defaultRoomSettings()
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
