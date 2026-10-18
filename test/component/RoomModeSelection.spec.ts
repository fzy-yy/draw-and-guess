import { setActivePinia, type Pinia } from 'pinia'
import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRoomSettings } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { EVENTS, MODE_SETTINGS_KEYS } from '@draw-guess/shared'
import CreateRoomDialog from '@/components/lobby/CreateRoomDialog.vue'
import RulesDialog from '@/components/room/RulesDialog.vue'
import RoomView from '@/views/RoomView.vue'
import { useGameStore } from '@/stores/game'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { HOST_ID, createRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport, type FakeGameTransport } from '../client/fake-game-transport'

let pinia: Pinia
let fakeTransport: FakeGameTransport

beforeEach(() => {
  const installed = createPiniaWithFakeTransport()
  pinia = installed.pinia
  fakeTransport = installed.fakeTransport
  setActivePinia(pinia)
})

/** 规则弹窗中可交互控件的计数口径（下拉＝SelectDropdown、开关＝原生 checkbox）。 */
function dropdowns(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]')]
}

function checkboxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
}

describe('建房弹窗的玩法模式单选（S27 / S28 / S61）', () => {
  it('顶部提供经典 / 接龙二选一，默认经典，且仍然没有人数档位', async () => {
    const user = userEvent.setup()
    const store = useGameStore()
    const createRoom = vi.spyOn(store, 'createRoom').mockResolvedValue(true)
    render(CreateRoomDialog, { props: { open: true }, global: { plugins: [pinia] } })

    const classic = screen.getByRole('radio', {
      name: new RegExp(strings.ui.lobby.gameModeClassic),
    }) as HTMLInputElement
    const relay = screen.getByRole('radio', {
      name: new RegExp(strings.ui.lobby.gameModeRelay),
    }) as HTMLInputElement
    // 模式在建房时选定：默认保持经典模式现状（协议默认值同源）
    expect(classic.checked).toBe(true)
    expect(relay.checked).toBe(false)
    // 容量固定为协议常量：弹窗内没有任何下拉（含已删除的人数档位）
    expect(dropdowns()).toHaveLength(0)

    await user.click(relay)
    expect(relay.checked).toBe(true)
    await user.click(screen.getByRole('button', { name: strings.ui.lobby.createAndEnter }))

    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ gameMode: 'relay', settings: defaultRoomSettings() }),
    )
  })

  it('不切换模式时建房请求显式带经典模式', async () => {
    const user = userEvent.setup()
    const store = useGameStore()
    const createRoom = vi.spyOn(store, 'createRoom').mockResolvedValue(true)
    render(CreateRoomDialog, { props: { open: true }, global: { plugins: [pinia] } })

    await user.click(screen.getByRole('button', { name: strings.ui.lobby.createAndEnter }))

    expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ gameMode: 'classic' }))
  })
})

describe('规则弹窗按模式裁剪字段（S39 / S52 / S83）', () => {
  it('接龙房只渲染接龙生效字段：三个时长 + 共用字段，经典专属字段与说明段都不出现', async () => {
    const draft = defaultRoomSettings()
    render(RulesDialog, {
      props: { open: true, draft, gameMode: 'relay' },
      global: { plugins: [pinia] },
    })

    // 接龙生效：三个接龙时长（下拉）+ 候选词数（下拉）+ 三个共用开关
    for (const label of [
      strings.ui.room.relayChooseSecondsField,
      strings.ui.room.relayDrawSecondsField,
      strings.ui.room.relayGuessSecondsField,
      strings.ui.room.optionCountField,
      strings.ui.room.togglePlayerInvite,
      strings.ui.room.toggleAllowWordReroll,
      strings.ui.room.toggleAllowCustomWord,
    ])
      expect(screen.getByLabelText(new RegExp(label))).toBeTruthy()

    // 经典专属字段在接龙下不渲染（S83：直接不出现，也不显示「不生效」说明段）
    for (const label of [
      strings.ui.common.roundsField,
      strings.ui.room.drawSecondsField,
      strings.ui.room.chooseTimeField,
      strings.ui.room.toggleShowWordLength,
      strings.ui.room.toggleProgressiveHints,
      strings.ui.room.nearMissHintLabel,
      strings.ui.room.canvasReactionsLabel,
      strings.ui.room.roundReplayLabel,
    ])
      expect(screen.queryByLabelText(new RegExp(label))).toBeNull()
    expect(screen.queryByText(/不生效/u)).toBeNull()
    expect(screen.queryByText(/经典专属/u)).toBeNull()

    // 控件计数：4 个下拉（三时长 + 候选词数）与 3 个共用开关
    expect(dropdowns()).toHaveLength(4)
    expect(checkboxes()).toHaveLength(3)
  })

  it('接龙规则可编辑三个时长，保存时把改动写进草稿', async () => {
    const user = userEvent.setup()
    const draft = defaultRoomSettings()
    const onSave = vi.fn()
    render(RulesDialog, {
      props: { open: true, draft, gameMode: 'relay', onSave },
      global: { plugins: [pinia] },
    })

    await user.click(screen.getByLabelText(strings.ui.room.relayChooseSecondsField))
    await user.click(await screen.findByRole('option', { name: strings.ui.common.secondsUnit(15) }))
    await user.click(screen.getByRole('button', { name: strings.ui.room.saveRules }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ relayChooseSeconds: 15 }))
  })

  it('经典房保持原有字段集合：不出现三个接龙时长', () => {
    const draft = defaultRoomSettings()
    render(RulesDialog, {
      props: { open: true, draft, gameMode: 'classic' },
      global: { plugins: [pinia] },
    })

    expect(screen.getByLabelText(new RegExp(strings.ui.room.drawSecondsField))).toBeTruthy()
    for (const label of [
      strings.ui.room.relayChooseSecondsField,
      strings.ui.room.relayDrawSecondsField,
      strings.ui.room.relayGuessSecondsField,
    ])
      expect(screen.queryByLabelText(new RegExp(label))).toBeNull()
    expect(dropdowns()).toHaveLength(4)
    expect(checkboxes()).toHaveLength(8)
  })

  it('接龙房保存规则时只上送接龙生效字段（完整草稿按模式裁剪，服务端才接受）', async () => {
    const user = userEvent.setup()
    const fixture = createRoomFixture('waiting')
    useSessionStore().playerId = HOST_ID
    useRoomStore().room = { ...fixture, gameMode: 'relay' }
    render(RoomView, { global: { plugins: [pinia] } })

    // 打开规则弹窗并改一个接龙时长，然后保存
    await user.click(screen.getByRole('button', { name: strings.ui.room.rulesEdit }))
    await user.click(screen.getByLabelText(strings.ui.room.relayGuessSecondsField))
    await user.click(await screen.findByRole('option', { name: strings.ui.common.secondsUnit(60) }))
    await user.click(screen.getByRole('button', { name: strings.ui.room.saveRules }))

    await waitFor(() =>
      expect(fakeTransport.requests.some((r) => r.event === EVENTS.roomUpdateSettings)).toBe(true),
    )
    const sent = fakeTransport.requests.find((r) => r.event === EVENTS.roomUpdateSettings)
    if (!sent) throw new Error('未发出规则更新请求')
    const patch = sent.payload.patch as Record<string, unknown>
    // 补丁恰为接龙生效键：经典专属键一个都不上送（否则服务端按白名单拒绝）
    expect(Object.keys(patch).sort()).toEqual([...MODE_SETTINGS_KEYS.relay].sort())
    expect(patch.relayGuessSeconds).toBe(60)
    expect('roundsPerPlayer' in patch).toBe(false)
  })
})
