import { defineComponent, h, nextTick } from 'vue'
import { setActivePinia, type Pinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomSnapshot } from '@draw-guess/shared'
import { useGuessConfetti } from '@/composables/useGuessConfetti'
import { useGameStore } from '@/stores/game'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'
import { GUEST_ID, createRoomFixture } from '../client/room-fixture'

const { fireSpy } = vi.hoisted(() => ({ fireSpy: vi.fn() }))
vi.mock('@/utils/confetti', () => ({ fireGuessCorrectConfetti: fireSpy }))

/** 最小宿主：只挂载 composable，模拟 GameView 的调用位置。 */
const Harness = defineComponent({
  setup() {
    useGuessConfetti(useGameStore())
    return () => h('div')
  },
})

let pinia: Pinia

beforeEach(() => {
  fireSpy.mockClear()
  pinia = createPiniaWithFakeTransport().pinia
  setActivePinia(pinia)
  useSessionStore().playerId = GUEST_ID
  mount(Harness, { global: { plugins: [pinia] } })
})

/** 写入一份房间快照，并按需改写本机玩家的「已猜中」位。 */
function applyRoom(phase: RoomSnapshot['phase'], guessed: boolean): void {
  const snapshot = createRoomFixture(phase)
  useRoomStore().room = {
    ...snapshot,
    members: snapshot.members.map((member) =>
      member.id === GUEST_ID ? { ...member, guessed } : member,
    ),
  }
}

describe('useGuessConfetti 猜中礼花触发', () => {
  it('作画阶段猜中（false→true）触发一次礼花', async () => {
    applyRoom('drawing', false)
    await nextTick()
    applyRoom('drawing', true)
    await nextTick()
    expect(fireSpy).toHaveBeenCalledTimes(1)
  })

  it('最后一人猜中（同一快照已切到 round_result）也触发礼花', async () => {
    applyRoom('drawing', false)
    await nextTick()
    applyRoom('round_result', true)
    await nextTick()
    expect(fireSpy).toHaveBeenCalledTimes(1)
  })

  it('最终结算阶段（game_result）的跃迁同样触发，不枚举阶段', async () => {
    applyRoom('drawing', false)
    await nextTick()
    applyRoom('game_result', true)
    await nextTick()
    expect(fireSpy).toHaveBeenCalledTimes(1)
  })

  it('挂载首帧快照里已是「已猜中」（undefined→true）不触发，避免重载补放', async () => {
    applyRoom('drawing', true)
    await nextTick()
    expect(fireSpy).not.toHaveBeenCalled()
  })

  it('关闭动画时不触发', async () => {
    useSettingsStore().settings.animationsEnabled = false
    applyRoom('drawing', false)
    await nextTick()
    applyRoom('drawing', true)
    await nextTick()
    expect(fireSpy).not.toHaveBeenCalled()
  })

  it('同一「已猜中」状态重复快照只触发一次', async () => {
    applyRoom('drawing', false)
    await nextTick()
    applyRoom('drawing', true)
    await nextTick()
    applyRoom('drawing', true)
    await nextTick()
    expect(fireSpy).toHaveBeenCalledTimes(1)
  })
})
