import { setActivePinia, type Pinia } from 'pinia'
import { render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { strings } from '@draw-guess/strings'
import {
  RELAY_MIN_PLAYERS,
  RELAY_STEP_COUNT,
  type GameMode,
  type PublicRoom,
  type RoomMember,
  type RoomSnapshot,
} from '@draw-guess/shared'
import LobbyView from '@/views/LobbyView.vue'
import RoomView from '@/views/RoomView.vue'
import { useLobbyStore } from '@/stores/lobby'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { HOST_ID, createRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'

let pinia: Pinia

beforeEach(() => {
  pinia = createPiniaWithFakeTransport().pinia
  setActivePinia(pinia)
})

/** 固定成员模板生成一名可玩玩家：序号决定 id 与昵称，连接状态可调（门禁按在线计数）。 */
function member(index: number, connection: RoomMember['connection'] = 'online'): RoomMember {
  return {
    ...createRoomFixture('waiting').members[0]!,
    id: `00000000-0000-4000-8000-0000000000${index}1`,
    nickname: `玩家${index}`,
    isHost: false,
    ready: true,
    connection,
  }
}

/** 组装等待阶段房间：房主（测试登录人）恒在最前，模式与其余成员由用例给定。 */
function waitingRoom(gameMode: GameMode, members: RoomMember[]): RoomSnapshot {
  const fixture = createRoomFixture('waiting')
  return {
    ...fixture,
    gameMode,
    members: [{ ...fixture.members[0]!, isHost: true, ready: true }, ...members],
  }
}

/** 以房主身份进入等待页（快照直接注入 store，与服务端推送到达后的状态一致）。 */
function renderRoomAsHost(gameMode: GameMode, members: RoomMember[]): void {
  useSessionStore().playerId = HOST_ID
  useRoomStore().room = waitingRoom(gameMode, members)
  render(RoomView, { global: { plugins: [pinia] } })
}

/** 当前开始按钮（可能处于置灰态）。 */
function startButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: new RegExp(strings.ui.room.startGame),
  }) as HTMLButtonElement
}

describe('等待页模式徽标与开局门禁（S47 / S62 / S80）', () => {
  it('接龙房：徽标在房间名之后；在线可玩不足 4 人时置灰开始按钮并说明原因', async () => {
    renderRoomAsHost('relay', [member(1), member(2)])

    // 徽标内容由 gameMode 决定，且紧跟在房间名之后（同一 leading 区）
    const roomName = screen.getByRole('heading', { name: '测试房间' })
    expect(roomName.nextElementSibling).toBe(screen.getByText(strings.ui.room.modeRelay))

    // 3 名在线可玩 < 4：置灰并给出原因（原因文案含门槛常量与当前人数）
    expect(startButton().disabled).toBe(true)
    expect(
      screen.getByText(strings.ui.room.relayGateNeedPlayers(RELAY_MIN_PLAYERS, 3)),
    ).toBeTruthy()

    // 右栏摘要同样按模式裁剪：只列接龙三时长，不列经典的轮数 / 单回合时长 / 选词阶段
    const settings = useRoomStore().room?.settings
    if (!settings) throw new Error('测试房间未装配')
    for (const label of [
      strings.ui.room.relayChooseSecondsField,
      strings.ui.room.relayDrawSecondsField,
      strings.ui.room.relayGuessSecondsField,
    ])
      expect(screen.getByText(label)).toBeTruthy()
    expect(screen.getByText(strings.ui.common.secondsUnit(settings.relayDrawSeconds))).toBeTruthy()
    expect(screen.queryByText(strings.ui.room.ruleRoundsDt)).toBeNull()
    expect(screen.queryByText(strings.ui.room.ruleDrawDt)).toBeNull()
    expect(screen.queryByText(strings.ui.room.ruleChooseTimeDt)).toBeNull()

    // 补齐第 4 名在线且已准备的成员：门禁打开、原因消失
    const room = useRoomStore().room
    if (!room) throw new Error('测试房间未装配')
    room.members.push(member(3))
    await waitFor(() => expect(startButton().disabled).toBe(false))
    expect(
      screen.queryByText(strings.ui.room.relayGateNeedPlayers(RELAY_MIN_PLAYERS, 3)),
    ).toBeNull()
  })

  it('接龙房：成员掉线后重新置灰（门禁按在线且可玩计数）', async () => {
    renderRoomAsHost('relay', [member(1), member(2), member(3)])
    const room = useRoomStore().room
    if (!room) throw new Error('测试房间未装配')
    expect(startButton().disabled).toBe(false)

    // 第 4 名成员掉线：在线可玩掉回 3 人，按钮重新置灰并给出原因
    room.members[3]!.connection = 'reconnecting'
    await screen.findByText(strings.ui.room.relayGateNeedPlayers(RELAY_MIN_PLAYERS, 3))
    expect(startButton().disabled).toBe(true)
  })

  it('经典房：徽标同样显示为经典，且不出现接龙门禁文案', () => {
    // 经典模式的最小可玩人数是 2（共享配置）：只有房主一人时按钮置灰
    renderRoomAsHost('classic', [])

    const roomName = screen.getByRole('heading', { name: '测试房间' })
    expect(roomName.nextElementSibling).toBe(screen.getByText(strings.ui.room.modeClassic))
    // 经典模式维持现状：人数不足时只置灰，不新增原因文案
    expect(startButton().disabled).toBe(true)
    expect(
      screen.queryByText(strings.ui.room.relayGateNeedPlayers(RELAY_MIN_PLAYERS, 1)),
    ).toBeNull()
  })
})

describe('大厅房间行的模式徽标与开局后加入入口（S36 / S47）', () => {
  function publicRoom(patch: Partial<PublicRoom> = {}): PublicRoom {
    return {
      visibility: 'public',
      id: '00000000-0000-4000-8000-0000000000a1',
      name: '公开画室',
      hostName: '房主甲',
      playerCount: 2,
      gameMode: 'classic',
      phase: 'waiting',
      roundsPerPlayer: 2,
      drawSeconds: 120,
      ...patch,
    }
  }

  it('等待中的房间可加入；开局后的房间入口置灰并显示「游戏中」', () => {
    useLobbyStore().presence.rooms = [
      publicRoom(),
      publicRoom({
        id: '00000000-0000-4000-8000-0000000000a2',
        name: '对局中画室',
        phase: 'drawing',
      }),
    ]
    render(LobbyView, { global: { plugins: [pinia] } })

    const joinable = screen.getByRole('button', { name: strings.ui.lobby.joinButton })
    expect((joinable as HTMLButtonElement).disabled).toBe(false)

    const inProgress = screen.getByRole('button', { name: strings.ui.lobby.joinInProgress })
    expect((inProgress as HTMLButtonElement).disabled).toBe(true)
  })

  it('房间行显示模式徽标（经典与接龙都显示），容量显示固定 6 人', () => {
    useLobbyStore().presence.rooms = [
      publicRoom(),
      publicRoom({
        id: '00000000-0000-4000-8000-0000000000a2',
        name: '接龙画室',
        gameMode: 'relay',
      }),
    ]
    render(LobbyView, { global: { plugins: [pinia] } })

    expect(screen.getByText(strings.ui.room.modeClassic)).toBeTruthy()
    expect(screen.getByText(strings.ui.room.modeRelay)).toBeTruthy()
    // 容量固定为协议常量：两行都按 6 席位展示（不再读房间字段）
    expect(screen.getAllByText('2/6')).toHaveLength(2)
  })

  it('接龙房间行只显示固定棒数，不显示经典专属的轮数与单回合时长（S39 / S52）', () => {
    useLobbyStore().presence.rooms = [publicRoom({ name: '接龙画室', gameMode: 'relay' })]
    render(LobbyView, { global: { plugins: [pinia] } })

    expect(
      screen.getByText(strings.ui.lobby.roomMetaRelay('房主甲', RELAY_STEP_COUNT)),
    ).toBeTruthy()
    // 轮数与单回合时长是经典专属字段：接龙房不再渲染经典口径的「轮 · 秒」行
    expect(screen.queryByText(strings.ui.lobby.roomMeta('房主甲', 2, 120))).toBeNull()
  })
})
