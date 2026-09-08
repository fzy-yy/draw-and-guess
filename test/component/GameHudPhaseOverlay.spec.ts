import { defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { strings } from '@draw-guess/strings'
import { useGameHud } from '@/composables/useGameHud'
import GameHud from '@/components/game/GameHud.vue'
import PhaseOverlay from '@/components/game/PhaseOverlay.vue'
import { useGameStore } from '@/stores/game'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { GUEST_ID, HOST_ID, createRoomFixture } from '../client/room-fixture'

let pinia: Pinia
let mountedHud!: ReturnType<typeof useGameHud>

const GameHudComposableHarness = defineComponent({
  setup() {
    mountedHud = useGameHud(useGameStore())
    return () => h('div')
  },
})

beforeEach(() => {
  pinia = createPinia()
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
  it('画家可切换答案明文，猜词者始终只看到遮罩', async () => {
    const roomStore = useRoomStore()
    const session = useSessionStore()
    roomStore.room = createRoomFixture()
    session.playerId = HOST_ID
    useSettingsStore().settings.drawerDefaultReveal = false
    const game = roomStore.room.game!
    const wrapper = mountWithPinia(GameHud, {
      isFullscreen: false,
      game,
      secondsLeft: 30,
      progress: 0.5,
      drawer: roomStore.room.members[0],
    }) as VueWrapper

    expect(wrapper.text()).toContain(game.answerMask)
    expect(wrapper.text()).not.toContain(game.answer)
    await wrapper.get(`[aria-label="${strings.game.toggleAnswerVisibilityAria}"]`).trigger('click')
    expect(wrapper.text()).toContain(game.answer)
    expect(wrapper.text()).toContain(game.wordCategory)

    session.playerId = GUEST_ID
    await nextTick()
    expect(wrapper.text()).toContain(game.answerMask)
    expect(wrapper.text()).not.toContain(game.answer)
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

    expect(wrapper.text()).toContain(strings.game.resumeGame)
    expect(wrapper.text()).toContain(strings.game.endEarly)
    session.playerId = GUEST_ID
    await nextTick()
    expect(wrapper.text()).not.toContain(strings.game.resumeGame)

    roomStore.room.phase = 'choosing_word'
    roomStore.room.game!.wordOptions = [
      { id: 'word-1', text: '苹果', difficulty: 1 },
      { id: 'word-2', text: '香蕉', difficulty: 2 },
    ]
    session.playerId = HOST_ID
    await nextTick()
    expect(wrapper.text()).toContain('苹果')
    session.playerId = GUEST_ID
    await nextTick()
    expect(wrapper.text()).not.toContain('苹果')
    wrapper.unmount()
  })
})
