import { defineComponent, h, nextTick } from 'vue'
import { setActivePinia, type Pinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { strings } from '@draw-guess/strings'
import { useGameHud } from '@/composables/useGameHud'
import GameHud from '@/components/game/GameHud.vue'
import PhaseOverlay from '@/components/game/PhaseOverlay.vue'
import PlayerPanel from '@/components/game/PlayerPanel.vue'
import { useGameStore } from '@/stores/game'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { GUEST_ID, HOST_ID, createRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'

let pinia: Pinia
let mountedHud!: ReturnType<typeof useGameHud>

const GameHudComposableHarness = defineComponent({
  setup() {
    mountedHud = useGameHud(useGameStore())
    return () => h('div')
  },
})

beforeEach(() => {
  pinia = createPiniaWithFakeTransport().pinia
  setActivePinia(pinia)
})

function mountWithPinia(component: Parameters<typeof mount>[0], props: Record<string, unknown>) {
  return mount(component, { props, global: { plugins: [pinia] } })
}

describe('useGameHud 角色与计时派生', () => {
  it('猜词者可猜、暂停冻结计时，并按服务端榜单展示最终排名', async () => {
    const now = Date.now()
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture('drawing', {
      phaseStartedAt: now - 30_000,
      phaseEndsAt: now + 30_000,
    })
    session.playerId = GUEST_ID
    const wrapper = mount(GameHudComposableHarness, { global: { plugins: [pinia] } })
    const hud = mountedHud

    expect(hud.canGuess.value).toBe(true)
    expect(hud.secondsLeft.value).toBeGreaterThanOrEqual(29)
    expect(hud.progress.value).toBeGreaterThan(0.45)
    expect(hud.drawer.value?.id).toBe(HOST_ID)

    roomStore.room.phase = 'paused'
    roomStore.room.game!.pausedRemainingMs = 12_500
    await nextTick()
    expect(hud.secondsLeft.value).toBe(13)
    expect(hud.canGuess.value).toBe(false)
    expect(hud.phaseLabel.value).toBe(strings.status.phasePaused)

    roomStore.room.phase = 'game_result'
    roomStore.room.game!.finalRanking = [
      {
        id: GUEST_ID,
        nickname: '冻结第一名',
        avatarId: '02',
        rank: 1,
        score: 99,
        stats: { correctCount: 1, totalGuessMs: 2_000, drawingCorrectCount: 0 },
      },
    ]
    await nextTick()
    expect(hud.rankings.value.map(({ nickname }) => nickname)).toEqual(['冻结第一名'])
    wrapper.unmount()
  })

  it('无倒计时安全归零，并在实时成员榜单中排除观战者和保留并列名次', () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture('drawing', { phaseStartedAt: 2_000, phaseEndsAt: 1_000 })
    roomStore.room.members[1]!.score = 20
    roomStore.room.members.push({
      ...roomStore.room.members[1]!,
      id: '00000000-0000-4000-8000-000000000010',
      nickname: '观战者',
      spectating: true,
      waitingForNextGame: false,
      rematchReady: false,
      score: 999,
    })
    session.playerId = GUEST_ID
    const wrapper = mount(GameHudComposableHarness, { global: { plugins: [pinia] } })
    const hud = mountedHud

    expect(hud.secondsLeft.value).toBe(0)
    expect(hud.progress.value).toBe(0)
    expect(hud.rankings.value.map(({ rank }) => rank)).toEqual([1, 1])
    expect(hud.rankings.value.map(({ nickname }) => nickname)).not.toContain('观战者')

    roomStore.room.members[1]!.guessed = true
    expect(hud.canGuess.value).toBe(false)
    roomStore.room.members[1]!.guessed = false
    roomStore.room.members[1]!.connection = 'reconnecting'
    expect(hud.canGuess.value).toBe(false)
    wrapper.unmount()
  })
})

describe('GameHud 与 PhaseOverlay 角色差异', () => {
  it('画家可切换答案明文，猜词者始终只看到遮罩且顶栏提供面板开关', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    // 结构化提示已移除：画家只有「明文 / 遮罩」两态，猜词者恒为服务端遮罩（见 ADR-0042）。
    roomStore.room = createRoomFixture('drawing')
    session.playerId = HOST_ID
    useSettingsStore().settings.drawerDefaultReveal = false
    const game = roomStore.room.game!
    const wrapper = mountWithPinia(GameHud, {
      isFullscreen: false,
      game,
      secondsLeft: 30,
      progress: 0.5,
      showTools: true,
      playersOpen: true,
      chatOpen: true,
      toolsOpen: true,
    }) as VueWrapper

    // 顶栏只保留回合/题目/系统操作与面板开关，不再有当前画家或提示区
    expect(wrapper.find(`[aria-label="${strings.game.togglePlayers}"]`).exists()).toBe(true)
    expect(wrapper.find(`[aria-label="${strings.game.toggleChat}"]`).exists()).toBe(true)
    expect(wrapper.find(`[aria-label="${strings.game.toggleTools}"]`).exists()).toBe(true)

    // 画家默认按本地偏好显示遮罩
    expect(wrapper.text()).toContain(game.answerMask)
    expect(wrapper.text()).not.toContain(game.answer)

    // 点击题目胶囊切换为明文
    await wrapper.get(`[aria-label="${strings.game.toggleAnswerVisibilityAria}"]`).trigger('click')
    expect(wrapper.text()).toContain(game.answer)

    // 猜词者本人：题目不可点击，恒为遮罩
    session.playerId = GUEST_ID
    await nextTick()
    expect(wrapper.text()).toContain(game.answerMask)
    expect(wrapper.text()).not.toContain(game.answer)
    expect(wrapper.find(`[aria-label="${strings.game.toggleAnswerVisibilityAria}"]`).exists()).toBe(
      false,
    )
    wrapper.unmount()
  })

  it('暂停操作只向房主显示，选词候选只向画家显示', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture('paused', { pausedRemainingMs: 10_000 })
    session.playerId = HOST_ID
    const wrapper = mountWithPinia(PhaseOverlay, {
      secondsLeft: 10,
      game: roomStore.room.game,
      rankings: [],
    }) as VueWrapper

    expect(wrapper.findAll('[aria-live]').length).toBe(1)
    expect(wrapper.get('[aria-live]').text()).toBe(strings.status.phasePaused)

    expect(wrapper.text()).toContain(strings.game.resumeGame)
    expect(wrapper.text()).toContain(strings.game.endEarly)
    session.playerId = GUEST_ID
    await nextTick()
    expect(wrapper.text()).not.toContain(strings.game.resumeGame)

    roomStore.room.phase = 'choosing_word'
    roomStore.room.game!.wordOptions = [
      { id: 'word-1', text: '苹果', difficulty: 1, drawability: 2 },
      { id: 'word-2', text: '香蕉', difficulty: 2, drawability: 3 },
    ]
    session.playerId = HOST_ID
    await nextTick()
    expect(wrapper.get('[aria-live]').text()).toBe(strings.status.phaseChoosing)
    expect(wrapper.text()).toContain('苹果')
    // 选词卡新形态：纯色无修饰（无 navy 边框/厚底边）、只显一行难度星、
    // 不显示「难度/可绘」文字标签与可绘制性星级（可绘制性由玩家自行判断）
    const wordCard = wrapper.findAll('button').find((button) => button.text().includes('苹果'))
    expect(wordCard, '画家应看到「苹果」候选词按钮').toBeTruthy()
    expect(wordCard!.classes().join(' ')).not.toMatch(/border-navy|border-b-/)
    expect(wrapper.text()).not.toContain('可绘')
    expect(wrapper.find('[aria-label="难度 1 星"]').exists()).toBe(true)
    session.playerId = GUEST_ID
    await nextTick()
    expect(wrapper.text()).not.toContain('苹果')
    wrapper.unmount()
  })

  it('最终结算中房主拥有全局返回动作，普通成员只登记个人再来一局状态', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture('game_result')
    roomStore.room.game!.canReturnWaiting = true
    roomStore.room.game!.finalRanking = []
    session.playerId = HOST_ID
    const overlay = mountWithPinia(PhaseOverlay, {
      secondsLeft: 12,
      game: roomStore.room.game,
      rankings: [],
    }) as VueWrapper

    expect(overlay.text()).toContain(strings.game.hostReturnWaiting)
    expect(overlay.text()).not.toContain(strings.game.rematchReady)

    session.playerId = GUEST_ID
    await nextTick()
    expect(overlay.text()).toContain(strings.game.rematch)
    expect(overlay.text()).not.toContain(strings.game.hostReturnWaiting)
    await overlay
      .findAll('button')
      .find((button) => button.text().includes(strings.game.rematch))!
      .trigger('click')
    expect(overlay.emitted('return-waiting')).toHaveLength(1)

    roomStore.room.members[1]!.rematchReady = true
    await nextTick()
    // 后台成员身份由玩家面板展示（原 ScoreStrip 已被 PlayerPanel 取代，见 ADR-0043）。
    const panel = mountWithPinia(PlayerPanel, {}) as VueWrapper
    expect(panel.text()).toContain(strings.status.roleRematchReady)
    panel.unmount()
    overlay.unmount()
  })
})
