import { defineComponent, h, nextTick } from 'vue'
import { setActivePinia, type Pinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { EVENTS, type RoomMember, type RoomSnapshot } from '@draw-guess/shared'
import { PUBLIC_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import ChatPanel from '@/components/game/ChatPanel.vue'
import GameHud from '@/components/game/GameHud.vue'
import PhaseOverlay from '@/components/game/PhaseOverlay.vue'
import PlayerPanel from '@/components/game/PlayerPanel.vue'
import RelayPlayerChip from '@/components/game/RelayPlayerChip.vue'
import RelayPlayerStatus from '@/components/game/relay/RelayPlayerStatus.vue'
import { useGameHud } from '@/composables/useGameHud'
import { useGameStore } from '@/stores/game'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import {
  GUEST_ID,
  HOST_ID,
  createRelayRoomFixture,
  createRoomFixture,
} from '../client/room-fixture'
import { createPiniaWithFakeTransport, type FakeGameTransport } from '../client/fake-game-transport'

/**
 * 接龙复用改造的组件面（S73 / S84）：
 * - `RelayPlayerChip` 的画笔角标语义（这一段里谁动手画了）；
 * - 四个既有组件的新增插槽 / props 形状（不传即现状，经典行为由既有用例守护）；
 * - 接龙选词卡（复用同一张选词卡，数据源与锁定态不同）与接龙聊天语义（走 `chat:say`）；
 * - HUD 的接龙派生（题面 / 棒次 / 上一家 chip / 提交状态 / 复盘链进度）。
 */

let pinia: Pinia
let fakeTransport: FakeGameTransport
/** HUD 派生只在 useGameHud 里算一次，harness 用于在组件外断言派生结果。 */
let mountedHud!: ReturnType<typeof useGameHud>

const GameHudComposableHarness = defineComponent({
  setup() {
    mountedHud = useGameHud(useGameStore())
    return () => h('div')
  },
})

beforeEach(() => {
  const installed = createPiniaWithFakeTransport()
  pinia = installed.pinia
  fakeTransport = installed.fakeTransport
  setActivePinia(pinia)
  fakeTransport.setConnected(true)
  // 假传输的 setConnected 只改 socket 标志；会话快照的 connected 由 bootstrap 的 connect 回调推进，
  // 这里直接置真以贴近线上（HUD 的展示用开局倒计时窗口据此判定「连接中不留锚点」）。
  useSessionStore().connected = true
})

/** 挂载单个组件（真实 Pinia + 假传输），返回包装器由用例断言并卸载。 */
function mountWithPinia(
  component: Parameters<typeof mount>[0],
  props: Record<string, unknown> = {},
): VueWrapper {
  return mount(component, { props, global: { plugins: [pinia] } })
}

/**
 * 接龙开局倒计时夹具：接龙房已进 `starting`，但该期服务端不下发 relay 视图（接龙阶段白名单，S22），
 * 快照形状＝「接龙房 + starting + 无 relay 视图」。
 */
function createRelayStartingFixture(): RoomSnapshot {
  const snapshot = createRelayRoomFixture()
  snapshot.phase = 'starting'
  delete snapshot.relay
  return snapshot
}

describe('RelayPlayerChip 画笔角标', () => {
  const player = { id: HOST_ID, nickname: '上一家', avatarId: '01' as const }

  it('渲染头像与昵称，默认不带角标', () => {
    const wrapper = mountWithPinia(RelayPlayerChip, { player })
    expect(wrapper.text()).toContain('上一家')
    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.find('svg').exists()).toBe(false)
    wrapper.unmount()
  })

  it('brushBadge 为真时挂出画笔角标，为假时不挂（角标语义＝这一段里此人动手画了）', () => {
    const withBadge = mountWithPinia(RelayPlayerChip, { player, brushBadge: true })
    // 角标与经典玩家面板同款底座：装饰性容器 + 画笔图标（对读屏隐藏）
    const badge = withBadge.find('span[aria-hidden="true"]')
    expect(badge.exists()).toBe(true)
    expect(badge.find('svg').exists()).toBe(true)
    withBadge.unmount()

    const withoutBadge = mountWithPinia(RelayPlayerChip, { player, brushBadge: false })
    expect(withoutBadge.find('span[aria-hidden="true"]').exists()).toBe(false)
    expect(withoutBadge.find('svg').exists()).toBe(false)
    withoutBadge.unmount()
  })
})

describe('GameHud 顶栏插槽', () => {
  // 经典侧（不传插槽）的渲染由 GameHudPhaseOverlay / game-view-shell 既有用例守护，
  // 这里只验证「传了插槽就用插槽、且两条内容互斥」。
  it('不传插槽时渲染经典回合胶囊与题目胶囊', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')
    const wrapper = mountWithPinia(GameHud, {
      isFullscreen: false,
      game: roomStore.room.game,
      secondsLeft: 30,
      progress: 0.5,
    })
    expect(wrapper.text()).toContain(strings.ui.game.roundLabel)
    expect(wrapper.text()).toContain(roomStore.room.game?.answerMask)
    wrapper.unmount()
  })

  it('传入 leading / center 插槽时整块替换左栏与正中内容', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')
    const wrapper = mount(GameHud, {
      props: {
        isFullscreen: false,
        game: roomStore.room.game,
        secondsLeft: 30,
        progress: 0.5,
      },
      slots: {
        leading: () => h('span', { class: 'relay-leading' }, '接龙选词'),
        center: () => h('span', { class: 'relay-center' }, '看图猜词'),
      },
      global: { plugins: [pinia] },
    })
    expect(wrapper.find('.relay-leading').text()).toBe('接龙选词')
    expect(wrapper.find('.relay-center').text()).toBe('看图猜词')
    // 经典的两颗胶囊被整块替换：既没有 ROUND 前缀，也没有题目文本
    expect(wrapper.text()).not.toContain(strings.ui.game.roundLabel)
    expect(wrapper.text()).not.toContain(roomStore.room.game?.answerMask)
    wrapper.unmount()
  })

  it('接龙禁用暂停：接龙房不渲染暂停按钮，经典房照旧渲染', () => {
    const roomStore = useRoomStore()
    useSessionStore().playerId = HOST_ID
    roomStore.room = createRelayRoomFixture('relay_draw')
    const relayHud = mountWithPinia(GameHud, {
      isFullscreen: false,
      game: undefined,
      secondsLeft: 30,
      progress: 0.5,
      phaseEndsAt: 61_000,
    })
    expect(relayHud.find(`[aria-label="${strings.a11y.game.pauseAriaHost}"]`).exists()).toBe(false)
    expect(relayHud.find(`[aria-label="${strings.a11y.game.pauseAriaGuest}"]`).exists()).toBe(false)
    // 接龙的截止时间来自接龙视图：倒计时照常渲染，而不是「不限时」占位
    expect(relayHud.text()).toContain('30')
    relayHud.unmount()

    roomStore.room = createRoomFixture('drawing')
    const classicHud = mountWithPinia(GameHud, {
      isFullscreen: false,
      game: roomStore.room.game,
      secondsLeft: 30,
      progress: 0.5,
    })
    expect(classicHud.find(`[aria-label="${strings.a11y.game.pauseAriaHost}"]`).exists()).toBe(true)
    classicHud.unmount()
  })
})

describe('PlayerPanel 状态插槽', () => {
  it('传入 status 插槽时第二行换成接龙提交状态，不传时仍是经典局内角色', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_draw')

    const withSlot = mount(PlayerPanel, {
      slots: {
        status: ({ member }: { member: RoomMember }) =>
          h(RelayPlayerStatus, { submitted: member.id === HOST_ID, mode: 'submit' }),
      },
      global: { plugins: [pinia] },
    })
    expect(withSlot.text()).toContain(strings.ui.game.relaySubmitted)
    expect(withSlot.text()).toContain(strings.ui.game.relayNotSubmitted)
    expect(withSlot.text()).not.toContain(strings.ui.status.roleGuessing)
    withSlot.unmount()

    const withoutSlot = mountWithPinia(PlayerPanel)
    expect(withoutSlot.text()).toContain(strings.ui.status.roleGuessing)
    expect(withoutSlot.text()).not.toContain(strings.ui.game.relaySubmitted)
    withoutSlot.unmount()
  })

  it('投票期的状态行按 mode 换成已投票 / 未投票', () => {
    useRoomStore().room = createRelayRoomFixture('relay_vote')
    const wrapper = mount(PlayerPanel, {
      slots: {
        status: ({ member }: { member: RoomMember }) =>
          h(RelayPlayerStatus, { submitted: member.id === GUEST_ID, mode: 'vote' }),
      },
      global: { plugins: [pinia] },
    })
    expect(wrapper.text()).toContain(strings.ui.game.relayNotVoted)
    expect(wrapper.text()).toContain(strings.ui.game.relayVoted)
    wrapper.unmount()
  })
})

describe('ChatPanel 聊天语义 props', () => {
  it('缺省仍是经典猜词频道：提交走 guess:submit，标题与角色标签不变', async () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('drawing')
    useSessionStore().playerId = GUEST_ID

    const wrapper = mountWithPinia(ChatPanel, { canGuess: true })
    expect(wrapper.text()).toContain(strings.ui.game.chatTitle)
    expect(wrapper.text()).toContain(strings.ui.status.roleGuessing)
    await wrapper.find('#guess-input').setValue('苹果')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(fakeTransport.requests.some((request) => request.event === EVENTS.guessSubmit)).toBe(
      true,
    )
    wrapper.unmount()
  })

  it('接龙语义：换标题与占位、提交走独立聊天事件、不再显示经典局内角色', async () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_draw')
    useSessionStore().playerId = HOST_ID

    const wrapper = mountWithPinia(ChatPanel, {
      canGuess: true,
      submitTarget: 'chat',
      title: strings.ui.game.relayChatTitle,
      placeholder: strings.ui.game.drawerChatPlaceholder,
    })
    expect(wrapper.text()).toContain(strings.ui.game.relayChatTitle)
    expect(wrapper.text()).not.toContain(strings.ui.status.roleGuessing)
    expect(wrapper.find<HTMLInputElement>('#guess-input').element.placeholder).toBe(
      strings.ui.game.drawerChatPlaceholder,
    )

    await wrapper.find('#guess-input').setValue('大家画得真快')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const chatRequest = fakeTransport.requests.find((request) => request.event === EVENTS.chatSay)
    expect(chatRequest?.payload).toMatchObject({ text: '大家画得真快' })
    // 接龙的聊天与作答彻底分离：这条输入框永远不会发出猜词事件（S20 / S79）
    expect(fakeTransport.requests.some((request) => request.event === EVENTS.guessSubmit)).toBe(
      false,
    )
    expect(wrapper.find<HTMLInputElement>('#guess-input').element.value).toBe('')
    wrapper.unmount()
  })

  it('无障碍名按语义分流：接龙聊天用聊天口径，经典侧仍是猜词口径', () => {
    const roomStore = useRoomStore()
    useSessionStore().playerId = HOST_ID

    roomStore.room = createRelayRoomFixture('relay_draw')
    const relayPanel = mountWithPinia(ChatPanel, {
      canGuess: true,
      submitTarget: 'chat',
      title: strings.ui.game.relayChatTitle,
      placeholder: strings.ui.game.drawerChatPlaceholder,
    })
    // 输入区与发送钮的读屏文案都不是猜词语义（S79：这条输入框只发聊天消息）
    expect(relayPanel.find('label[for="guess-input"]').text()).toBe(
      strings.a11y.game.relayChatInputAria,
    )
    expect(relayPanel.find('button[type="submit"]').attributes('aria-label')).toBe(
      strings.a11y.game.relayChatSendAria,
    )
    expect(relayPanel.text()).not.toContain(strings.ui.game.guessLabel)
    expect(relayPanel.find('button[type="submit"]').attributes('aria-label')).not.toBe(
      strings.a11y.game.sendGuessAria,
    )
    relayPanel.unmount()

    roomStore.room = createRoomFixture('drawing')
    const classicPanel = mountWithPinia(ChatPanel, { canGuess: true })
    expect(classicPanel.find('label[for="guess-input"]').text()).toBe(strings.ui.game.guessLabel)
    expect(classicPanel.find('button[type="submit"]').attributes('aria-label')).toBe(
      strings.a11y.game.sendGuessAria,
    )
    classicPanel.unmount()
  })
})

describe('PhaseOverlay 接龙选词卡', () => {
  const WORD_ID = '00000000-0000-4000-8000-000000000007'

  function mountChooseOverlay(): VueWrapper {
    return mountWithPinia(PhaseOverlay, {
      secondsLeft: 12,
      game: undefined,
      rankings: [],
    })
  }

  it('复用同一张选词卡：圆底图标 + 候选词大按钮都来自接龙视图，标题只写「接龙 · 第 1 棒」（S83）', () => {
    useRoomStore().room = createRelayRoomFixture('relay_choose', {
      wordOptions: [{ id: WORD_ID, text: '长颈鹿' }],
      canReroll: true,
    })
    const wrapper = mountChooseOverlay()
    expect(wrapper.text()).toContain(strings.ui.game.chooseWordTitle)
    expect(wrapper.text()).toContain(strings.ui.game.relayChooseTitle)
    // 接龙下不带括号说明、也不再写经典的「轮到你作画了」（S83）
    expect(wrapper.text()).not.toContain(strings.ui.game.yourTurn)
    expect(wrapper.text()).toContain('长颈鹿')
    expect(wrapper.text()).toContain(strings.ui.game.autoChoose(12))
    wrapper.unmount()
  })

  it('经典选词卡的标题仍是「轮到你作画了」：接龙文案只作用于接龙卡', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRoomFixture('choosing_word', {
      wordOptions: [{ id: WORD_ID, text: '长颈鹿' }],
      canReroll: true,
    })
    useSessionStore().playerId = HOST_ID
    const wrapper = mountWithPinia(PhaseOverlay, {
      secondsLeft: 12,
      game: roomStore.room.game,
      rankings: [],
    })
    expect(wrapper.text()).toContain(strings.ui.game.yourTurn)
    expect(wrapper.text()).toContain(strings.ui.game.chooseWordTitle)
    expect(wrapper.text()).not.toContain(strings.ui.game.relayChooseTitle)
    wrapper.unmount()
  })

  it('点击候选词把词 id 抛给宿主（事件沿用经典，目标按模式在 store 层分流）', async () => {
    useRoomStore().room = createRelayRoomFixture('relay_choose', {
      wordOptions: [{ id: WORD_ID, text: '长颈鹿' }],
      canReroll: true,
    })
    const wrapper = mountChooseOverlay()
    const option = wrapper.findAll('button').find((button) => button.text().includes('长颈鹿'))
    expect(option).toBeDefined()
    await option!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('choose-word')).toEqual([[WORD_ID]])
    // 选词请求由 GameView 转给 store（集成用例断言按步骤 id 发送），这里确认卡片本身不再自行发请求
    expect(fakeTransport.requests).toHaveLength(0)
    wrapper.unmount()
  })

  it('本链已选完词时收起候选与动作组，只提示等待其他玩家', () => {
    useRoomStore().room = createRelayRoomFixture('relay_choose', {
      submitted: true,
      wordOptions: [{ id: WORD_ID, text: '长颈鹿' }],
      canReroll: false,
    })
    const wrapper = mountChooseOverlay()
    expect(wrapper.text()).toContain(strings.ui.game.relayWaitingOthers)
    expect(wrapper.text()).not.toContain('长颈鹿')
    expect(wrapper.find(`[title="${strings.a11y.game.rerollWords}"]`).exists()).toBe(false)
    wrapper.unmount()
  })

  it('换一批用尽时按钮置灰并给出既有提示', () => {
    useRoomStore().room = createRelayRoomFixture('relay_choose', {
      wordOptions: [{ id: WORD_ID, text: '长颈鹿' }],
      canReroll: false,
    })
    const wrapper = mountChooseOverlay()
    const reroll = wrapper.find<HTMLButtonElement>(`[title="${strings.a11y.game.rerollUsed}"]`)
    expect(reroll.exists()).toBe(true)
    expect(reroll.element.disabled).toBe(true)
    wrapper.unmount()
  })
})

describe('useGameHud 接龙派生', () => {
  function mountHudHarness(): VueWrapper {
    return mount(GameHudComposableHarness, { global: { plugins: [pinia] } })
  }

  it('作画棒：题面＝本棒的词、棒次＝1、没有上一家 chip、左栏收集提交', () => {
    useRoomStore().room = createRelayRoomFixture('relay_draw', {
      prompt: '气球',
      submittedPlayerIds: [HOST_ID],
    })
    const wrapper = mountHudHarness()

    expect(mountedHud.relayPrompt.value).toBe('气球')
    expect(mountedHud.relayPromptKind.value).toBe('text')
    expect(mountedHud.relayStep.value).toBe(1)
    expect(mountedHud.relayArtist.value).toBeUndefined()
    expect(mountedHud.relayStatusMode.value).toBe('submit')
    expect(mountedHud.relaySubmittedIds.value.has(HOST_ID)).toBe(true)
    expect(mountedHud.relaySubmittedIds.value.has(GUEST_ID)).toBe(false)
    expect(mountedHud.relayChainProgress.value).toBeUndefined()
    wrapper.unmount()
  })

  it('猜词棒：题面＝看图猜词、上一家带画笔角标（画的就是你正在看的这幅画）', () => {
    useRoomStore().room = createRelayRoomFixture('relay_guess', {
      currentStep: 2,
      previousArtist: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' },
    })
    const wrapper = mountHudHarness()

    expect(mountedHud.relayPrompt.value).toBe(strings.ui.game.relayGuessPrompt)
    expect(mountedHud.relayPromptKind.value).toBe('question')
    expect(mountedHud.relayStep.value).toBe(2)
    expect(mountedHud.relayArtist.value?.nickname).toBe('猜词者')
    expect(mountedHud.relayArtistPaints.value).toBe(true)
    wrapper.unmount()
  })

  it('步 3 按上家的词作画：上一家 chip 在但不带角标（他没画东西给我）', () => {
    useRoomStore().room = createRelayRoomFixture('relay_draw', {
      currentStep: 3,
      prompt: '长颈鹿',
      previousArtist: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' },
    })
    const wrapper = mountHudHarness()

    expect(mountedHud.relayArtist.value?.nickname).toBe('猜词者')
    expect(mountedHud.relayArtistPaints.value).toBe(false)
    expect(mountedHud.relayPrompt.value).toBe('长颈鹿')
    wrapper.unmount()
  })

  it('投票期左栏收集投票状态，复盘展示期与终局不表达状态', () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayRoomFixture('relay_vote', {
      submittedPlayerIds: [GUEST_ID],
      showcase: {
        chainIndex: 2,
        chainCount: 4,
        half: 1,
        prompt: { player: { id: HOST_ID, nickname: '房主', avatarId: '01' }, text: '气球' },
        answer: { player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' }, text: '气球' },
        drawing: { strokes: [], undoneStrokeIds: [], lastSequence: -1, drawingRevision: 0 },
        votes: ['agree'],
      },
    })
    const wrapper = mountHudHarness()
    expect(mountedHud.relayStatusMode.value).toBe('vote')
    expect(mountedHud.relayChainProgress.value).toEqual({ index: 2, total: 4 })
    wrapper.unmount()

    roomStore.room = createRelayRoomFixture('relay_showcase', {
      showcase: {
        chainIndex: 2,
        chainCount: 4,
        half: 1,
        prompt: { player: { id: HOST_ID, nickname: '房主', avatarId: '01' }, text: '气球' },
        answer: { player: { id: GUEST_ID, nickname: '猜词者', avatarId: '02' }, text: null },
        drawing: { strokes: [], undoneStrokeIds: [], lastSequence: -1, drawingRevision: 0 },
      },
    })
    const showcaseWrapper = mountHudHarness()
    expect(mountedHud.relayStatusMode.value).toBe('none')
    expect(mountedHud.relayChainProgress.value).toEqual({ index: 2, total: 4 })
    showcaseWrapper.unmount()
  })

  it('开局倒计时期：还没有 relay 视图也有一份展示用倒计时窗口（时长取自公开配置）', async () => {
    const roomStore = useRoomStore()
    roomStore.room = createRelayStartingFixture()
    const wrapper = mountHudHarness()

    // 纯展示：本地窗口不推进阶段，房间仍在 starting（换阶段只由服务端快照驱动）
    expect(roomStore.room?.phase).toBe('starting')
    const windowMs = PUBLIC_CONFIG.game.startingCountdownSeconds * 1_000
    const localNow = Date.now() + useGameStore().clockOffset
    expect(mountedHud.phaseEndsAt.value).toBeGreaterThan(localNow)
    expect(mountedHud.phaseEndsAt.value).toBeLessThanOrEqual(localNow + windowMs)
    // 初始读数就是配置档位数，进度条同样由这个窗口驱动（不是「不限时」）
    expect(mountedHud.secondsLeft.value).toBe(PUBLIC_CONFIG.game.startingCountdownSeconds)
    expect(mountedHud.progress.value).toBeGreaterThan(0)

    // 接龙视图一到（权威 phaseEndsAt 就位），本地窗口即让位
    roomStore.room = createRelayRoomFixture('relay_choose', { phaseEndsAt: 61_000 })
    await nextTick()
    expect(mountedHud.phaseEndsAt.value).toBe(61_000)
    wrapper.unmount()
  })

  it('经典房间的接龙派生保持缺省：题面占位、棒次 0、无状态与链进度', () => {
    useRoomStore().room = createRoomFixture('drawing')
    const wrapper = mountHudHarness()

    expect(mountedHud.relay.value).toBeUndefined()
    expect(mountedHud.relayPrompt.value).toBe(strings.ui.game.awaitingWord)
    expect(mountedHud.relayPromptKind.value).toBe('text')
    expect(mountedHud.relayStep.value).toBe(0)
    expect(mountedHud.relayArtist.value).toBeUndefined()
    expect(mountedHud.relayArtistPaints.value).toBe(false)
    expect(mountedHud.relayStatusMode.value).toBe('none')
    expect(mountedHud.relaySubmittedIds.value.size).toBe(0)
    expect(mountedHud.relayChainProgress.value).toBeUndefined()
    // 经典截止时间仍取自对局视图
    expect(mountedHud.phaseEndsAt.value).toBe(61_000)
    wrapper.unmount()
  })
})
