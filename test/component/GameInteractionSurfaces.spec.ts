import { nextTick } from 'vue'
import { setActivePinia, type Pinia } from 'pinia'
import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strings } from '@draw-guess/strings'
import ChatPanel from '@/components/game/ChatPanel.vue'
import GameHud from '@/components/game/GameHud.vue'
import PhaseOverlay from '@/components/game/PhaseOverlay.vue'
import { useGameStore } from '@/stores/game'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import {
  createPiniaWithFakeTransport,
  installFakeGameTransport,
} from '../client/fake-game-transport'
import {
  GUEST_ID,
  HOST_ID,
  createLiveRelayRoomFixture,
  createRoomFixture,
} from '../client/room-fixture'

let pinia: Pinia

beforeEach(() => {
  pinia = createPiniaWithFakeTransport().pinia
  setActivePinia(pinia)
})

function renderWithPinia(component: Parameters<typeof render>[0], props: Record<string, unknown>) {
  return render(component, { props, global: { plugins: [pinia] } })
}

describe('GameHud 角色视图', () => {
  it('画家可用键盘切换明文，猜词者只能看到服务端遮罩', async () => {
    const user = userEvent.setup()
    const room = useRoomStore()
    const session = useSessionStore()
    // 结构化提示已移除：画家只有「明文 / 遮罩」两态，猜词者恒为服务端遮罩（见 ADR-0042）。
    room.room = createRoomFixture('drawing')
    session.playerId = HOST_ID
    useSettingsStore().settings.drawerDefaultReveal = false

    renderWithPinia(GameHud, {
      isFullscreen: false,
      game: room.room.game,
      secondsLeft: 30,
      progress: 0.5,
    })

    const answerToggle = screen.getByRole('button', {
      name: strings.a11y.game.toggleAnswerVisibilityAria,
    })
    expect(screen.getByText(room.room.game!.answerMask)).toBeTruthy()
    expect(screen.queryByText(room.room.game!.answer!)).toBeNull()

    answerToggle.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByText(room.room.game!.answer!)).toBeTruthy()

    session.playerId = GUEST_ID
    await nextTick()
    expect(
      screen.queryByRole('button', { name: strings.a11y.game.toggleAnswerVisibilityAria }),
    ).toBeNull()
    expect(screen.getByText(room.room.game!.answerMask)).toBeTruthy()
    expect(screen.queryByText(room.room.game!.answer!)).toBeNull()
  })

  it('成员可使用设置与全屏动作', async () => {
    const room = useRoomStore()
    const session = useSessionStore()
    room.room = createRoomFixture('drawing')
    session.playerId = GUEST_ID

    renderWithPinia(GameHud, {
      isFullscreen: false,
      game: room.room.game,
      secondsLeft: 12,
      progress: 0.2,
    })

    expect(
      (screen.getByRole('button', { name: strings.a11y.game.settingsAria }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
    expect(
      (
        screen.getByRole('button', {
          name: strings.a11y.game.enterFullscreenAria,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })
})

describe('ChatPanel 输入与快捷互动', () => {
  it('成功发送会清空草稿，失败会保留草稿供重试', async () => {
    const user = userEvent.setup()
    const room = useRoomStore()
    const session = useSessionStore()
    room.room = createRoomFixture()
    session.playerId = GUEST_ID
    const game = useGameStore()
    const submitGuess = vi
      .spyOn(game, 'submitGuess')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    renderWithPinia(ChatPanel, { canGuess: true })
    const input = screen.getByLabelText(strings.ui.game.guessLabel)
    const send = screen.getByRole('button', { name: strings.a11y.game.sendGuessAria })

    await user.type(input, '  苹果  ')
    await user.click(send)
    await waitFor(() => expect(submitGuess).toHaveBeenCalledWith('苹果'))
    expect((input as HTMLInputElement).value).toBe('  苹果  ')

    await user.click(send)
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
    expect(submitGuess).toHaveBeenCalledTimes(2)
  })

  it('无猜词权限时禁用输入，恢复权限后重新启用', async () => {
    const room = useRoomStore()
    const session = useSessionStore()
    room.room = createRoomFixture()
    session.playerId = HOST_ID

    const view = renderWithPinia(ChatPanel, { canGuess: false })
    expect((screen.getByLabelText(strings.ui.game.guessLabel) as HTMLInputElement).disabled).toBe(
      true,
    )
    expect(
      (screen.getByRole('button', { name: strings.a11y.game.sendGuessAria }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)

    await view.rerender({ canGuess: true })
    expect((screen.getByLabelText(strings.ui.game.guessLabel) as HTMLInputElement).disabled).toBe(
      false,
    )
    expect(
      (screen.getByRole('button', { name: strings.a11y.game.sendGuessAria }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('接龙聊天目标下，即使当前不可作答也必须能发送消息（聊天与作答彻底分离，S79）', async () => {
    // 缺陷回归：接龙房的聊天输入被 `canGuess`（只在猜词棒且未提交时为真）错误门禁——
    // 选词 / 作画 / 复盘期一律禁用，提交后也发不出，聊天区因此永远刷不出自己的消息。
    const fakeTransport = installFakeGameTransport(pinia)
    const user = userEvent.setup()
    const room = useRoomStore()
    const session = useSessionStore()
    room.room = createLiveRelayRoomFixture('relay_draw')
    session.playerId = HOST_ID

    renderWithPinia(ChatPanel, { canGuess: false, submitTarget: 'chat' })

    const input = screen.getByLabelText(strings.a11y.game.relayChatInputAria) as HTMLInputElement
    expect(input.disabled).toBe(false)

    await user.type(input, '这条消息必须发得出去')
    await user.click(screen.getByRole('button', { name: strings.a11y.game.relayChatSendAria }))

    await waitFor(() =>
      expect(fakeTransport.requests.map((entry) => entry.event)).toContain('chat:say'),
    )
    expect(fakeTransport.requests.find((entry) => entry.event === 'chat:say')?.payload.text).toBe(
      '这条消息必须发得出去',
    )

    // 经典猜词通路不受影响：无猜词权限时仍禁用（其语义是「作答」而非社交）
    const classicInput = screen.queryByLabelText(strings.ui.game.guessLabel)
    expect(classicInput).toBeNull()
  })

  it('聊天面板中仅展示玩家发出的消息，系统消息不出现在聊天列表中', async () => {
    const room = useRoomStore()
    const session = useSessionStore()
    room.room = createRoomFixture()
    session.playerId = GUEST_ID

    room.room.game!.messages = [
      {
        id: 'msg-sys',
        type: 'system',
        text: '作画开始，猜词玩家请在右侧输入答案',
        createdAt: Date.now(),
      },
      {
        id: 'msg-user',
        type: 'guess',
        playerId: HOST_ID,
        text: '这是一条猜词',
        createdAt: Date.now(),
      },
    ]

    renderWithPinia(ChatPanel, { canGuess: true })

    // 系统消息不再渲染在聊天流中（统一走 Toast 通知）
    expect(screen.queryByText('作画开始，猜词玩家请在右侧输入答案')).toBeNull()
    // 玩家消息正常渲染并带昵称徽章
    expect(screen.getByText('这是一条猜词')).toBeTruthy()
    expect(screen.getByText('房主')).toBeTruthy()
  })

  it('画家输入答案被客户端拦截并弹出 Toast，输入普通消息正常发送', async () => {
    const user = userEvent.setup()
    const room = useRoomStore()
    const session = useSessionStore()
    room.room = createRoomFixture()
    session.playerId = HOST_ID
    room.room.game!.drawerId = HOST_ID
    room.room.game!.answer = '猫咪'
    const game = useGameStore()
    const submitGuess = vi.spyOn(game, 'submitGuess').mockResolvedValue(true)

    renderWithPinia(ChatPanel, { canGuess: true })
    const input = screen.getByLabelText(strings.ui.game.guessLabel)
    const send = screen.getByRole('button', { name: strings.a11y.game.sendGuessAria })

    // 1. 画家输入答案「猫咪」并发送：被客户端直接拦截，不调用 submitGuess，弹出 Toast
    await user.type(input, '猫咪')
    await user.click(send)
    expect(submitGuess).not.toHaveBeenCalled()

    // 2. 清空并输入非答案消息「提示：一种宠物」：正常调用 submitGuess 发送
    await user.clear(input)
    await user.type(input, '提示：一种宠物')
    await user.click(send)
    await waitFor(() => expect(submitGuess).toHaveBeenCalledWith('提示：一种宠物'))
  })
})

describe('PhaseOverlay 阶段分支', () => {
  it('覆盖开局与选词阶段的角色动作', async () => {
    const user = userEvent.setup()
    const room = useRoomStore()
    const session = useSessionStore()
    room.room = createRoomFixture('starting')
    session.playerId = HOST_ID
    const onChooseWord = vi.fn()
    const onRerollWords = vi.fn()
    const onResume = vi.fn()

    renderWithPinia(PhaseOverlay, {
      secondsLeft: 3,
      game: room.room.game,
      rankings: [],
      onChooseWord,
      onRerollWords,
      onResume,
    })
    expect(screen.getByText('3')).toBeTruthy()

    room.room.phase = 'choosing_word'
    room.room.game!.wordOptions = [
      { id: 'word-1', text: '苹果' },
      { id: 'word-2', text: '香蕉' },
    ]
    room.room.game!.canReroll = true
    await nextTick()
    await user.click(screen.getByRole('button', { name: /苹果/ }))
    await user.click(screen.getByRole('button', { name: strings.ui.game.rerollWords }))
    expect(onChooseWord).toHaveBeenCalledWith('word-1')
    expect(onRerollWords).toHaveBeenCalledOnce()

    session.playerId = GUEST_ID
    await nextTick()
    expect(screen.queryByRole('button', { name: /苹果/ })).toBeNull()
  })
  it('回合结算展示权威计分明细，最终结算提供对应角色动作', async () => {
    const user = userEvent.setup()
    const room = useRoomStore()
    const session = useSessionStore()
    room.room = createRoomFixture('round_result', {
      roundResult: {
        answer: '苹果',
        drawerScore: 20,
        details: [{ playerId: GUEST_ID, order: 1, total: 100 }],
      },
    })
    session.playerId = GUEST_ID
    const onReturnWaiting = vi.fn()
    const onLeaveRoom = vi.fn()

    renderWithPinia(PhaseOverlay, {
      secondsLeft: 5,
      game: room.room.game,
      rankings: [],
      onReturnWaiting,
      onLeaveRoom,
    })
    expect(screen.getByText(strings.ui.game.roundAnswerLabel)).toBeTruthy()
    expect(screen.getByText(strings.ui.game.scoreOrderLabel(1))).toBeTruthy()
    expect(screen.getByText(strings.ui.game.scoreTotal(100))).toBeTruthy()

    room.room.phase = 'game_result'
    await nextTick()
    await user.click(screen.getByRole('button', { name: strings.ui.game.rematchWithSeconds(5) }))
    await user.click(screen.getByRole('button', { name: strings.ui.game.leaveRoom }))
    expect(onReturnWaiting).toHaveBeenCalledOnce()
    expect(onLeaveRoom).toHaveBeenCalledOnce()

    session.playerId = HOST_ID
    await nextTick()
    expect(
      (
        screen.getByRole('button', {
          name: strings.ui.game.hostReturnWaitingWithSeconds(5),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })
})
