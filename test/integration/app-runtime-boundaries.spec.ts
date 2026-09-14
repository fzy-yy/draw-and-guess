import { defineComponent, h, ref } from 'vue'
import { setActivePinia, type Pinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { EVENTS, createServerPush, type Stroke } from '@draw-guess/shared'
import { useAppBootstrap } from '@/composables/useAppBootstrap'
import { useStrokeSession } from '@/composables/useStrokeSession'
import { useGameplayStore } from '@/stores/gameplay'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { clearProtocolDiagnostics, getProtocolDiagnostics } from '@/stores/push-protocol'
import { createPiniaWithFakeTransport, type FakeGameTransport } from '../client/fake-game-transport'
import { GAME_ID, GUEST_ID, ROOM_ID, ROUND_ID, createRoomFixture } from '../client/room-fixture'

let pinia: Pinia
let fakeTransport: FakeGameTransport
const wrappers: VueWrapper[] = []
let activeHarnessSetup: () => void = () => undefined

const ComposableHarness = defineComponent({
  setup() {
    activeHarnessSetup()
    return () => h('div')
  },
})

function mountHarness(setup: () => void): void {
  activeHarnessSetup = setup
  wrappers.push(mount(ComposableHarness, { global: { plugins: [pinia] } }))
}

function mountBootstrap(): ReturnType<typeof useAppBootstrap> {
  let bootstrap!: ReturnType<typeof useAppBootstrap>
  mountHarness(() => {
    bootstrap = useAppBootstrap(fakeTransport.transport)
  })
  return bootstrap
}

function stroke(sequence: number): Stroke {
  return {
    kind: 'stroke',
    id: '00000000-0000-4000-8000-000000000006',
    tool: 'pen',
    color: '#1F2937',
    width: 5,
    points: [{ x: 0.2, y: 0.3 }],
    sequence,
    startPointIndex: 0,
  }
}

beforeEach(() => {
  const installed = createPiniaWithFakeTransport()
  pinia = installed.pinia
  fakeTransport = installed.fakeTransport
  setActivePinia(pinia)
  clearProtocolDiagnostics()
})

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  fakeTransport.transport.destroy()
})

describe('AppBootstrap 与重连接管', () => {
  it('先注册 push 监听再连接，并在断线、重连尝试和停止时同步会话状态', () => {
    const bootstrap = mountBootstrap()
    const session = useSessionStore()

    bootstrap.start()
    expect(fakeTransport.connectCalls()).toBe(1)
    expect(fakeTransport.listenerCount(EVENTS.roomSnapshot)).toBe(1)
    expect(session.connected).toBe(true)
    session.playerId = GUEST_ID

    fakeTransport.emit('disconnect', 'transport close')
    expect(session.connected).toBe(false)
    expect(session.sessionState).toBe('disconnected')
    expect(session.connectionLabel).toBe(strings.connection.reconnecting)

    fakeTransport.emitManager('reconnect_attempt')
    expect(session.sessionState).toBe('disconnected')
    expect(fakeTransport.managerListenerCount('reconnect_attempt')).toBe(1)

    bootstrap.stop()
    expect(fakeTransport.listenerCount(EVENTS.roomSnapshot)).toBe(0)
    expect(fakeTransport.disconnectCalls()).toBe(1)
  })

  it('非法 push 只记录脱敏诊断，并通过权威 resync 恢复当前房间', async () => {
    const room = useRoomStore()
    room.room = createRoomFixture('drawing', { drawingRevision: 1 })
    const authoritative = createRoomFixture('drawing', { drawingRevision: 2 })
    fakeTransport.setResponder((event, payload) => ({
      ok: true,
      requestId: String(payload.requestId),
      data: event === EVENTS.stateResync ? authoritative : undefined,
    }))
    const bootstrap = mountBootstrap()
    bootstrap.start()

    fakeTransport.emit(EVENTS.roomSnapshot, {
      protocolVersion: APP_CONFIG.app.protocolVersion,
      data: { id: ROOM_ID, members: '不是数组' },
    })

    await waitFor(() =>
      expect(fakeTransport.requests.some(({ event }) => event === EVENTS.stateResync)).toBe(true),
    )
    await waitFor(() => expect(room.room?.game?.drawingRevision).toBe(2))
    expect(
      fakeTransport.requests.find(({ event }) => event === EVENTS.stateResync)?.payload.reason,
    ).toBe('invalid_push')
    const diagnostic = getProtocolDiagnostics().at(-1)
    expect(diagnostic).toMatchObject({ event: EVENTS.roomSnapshot })
    expect(diagnostic?.reason).not.toContain('不是数组')
  })
})

describe('RoomSync push 门禁', () => {
  it('连续绘图增量合并到真 Store，revision 缺口只触发一次全量恢复', async () => {
    const room = useRoomStore()
    room.room = createRoomFixture('drawing', { drawingRevision: 1 })
    const authoritative = createRoomFixture('drawing', { drawingRevision: 4 })
    fakeTransport.setResponder((event, payload) => ({
      ok: true,
      requestId: String(payload.requestId),
      data: event === EVENTS.stateResync ? authoritative : undefined,
    }))
    const bootstrap = mountBootstrap()
    bootstrap.start()

    fakeTransport.emit(
      EVENTS.drawStrokeBatch,
      createServerPush({
        roomId: ROOM_ID,
        gameId: GAME_ID,
        roundId: ROUND_ID,
        drawingRevision: 2,
        stroke: stroke(2),
      }),
    )
    expect(room.room.game?.drawingRevision).toBe(2)
    expect(room.room.game?.strokes).toHaveLength(1)

    fakeTransport.emit(
      EVENTS.drawStrokeBatch,
      createServerPush({
        roomId: ROOM_ID,
        gameId: GAME_ID,
        roundId: ROUND_ID,
        drawingRevision: 4,
        stroke: { ...stroke(4), startPointIndex: 1 },
      }),
    )

    await waitFor(() => expect(room.room?.game?.drawingRevision).toBe(4))
    expect(fakeTransport.requests.filter(({ event }) => event === EVENTS.stateResync)).toHaveLength(
      1,
    )
    expect(
      fakeTransport.requests.find(({ event }) => event === EVENTS.stateResync)?.payload.reason,
    ).toBe('state_gap')
  })
})

describe('绘图失败回滚链路', () => {
  it('乐观预览经 fake transport 业务拒绝后清理，并请求权威画布', async () => {
    const room = useRoomStore()
    room.room = createRoomFixture()
    const gameplay = useGameplayStore()
    fakeTransport.setResponder((event, payload) => {
      if (event === EVENTS.drawStrokeBatch) {
        return {
          ok: false,
          requestId: String(payload.requestId),
          error: { code: 'DRAW_BUDGET_EXCEEDED', message: '预算超限' },
        }
      }
      return {
        ok: true,
        requestId: String(payload.requestId),
        data: event === EVENTS.stateResync ? createRoomFixture() : undefined,
      }
    })
    const redraw = vi.fn()
    const drawnPoints = new Map<string, number>()
    let session!: ReturnType<typeof useStrokeSession>
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLCanvasElement
    const context = {
      canvas: { width: 100, height: 100 },
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D

    mountHarness(() => {
      session = useStrokeSession({
        canvas: ref(canvas),
        width: ref(5),
        canDraw: () => true,
        tool: () => 'pen',
        color: () => '#1F2937',
        roundId: () => room.room?.game?.roundId ?? '',
        lastSequence: () => room.room?.game?.lastSequence ?? -1,
        drawnPoints,
        getContext: () => context,
        redraw,
        present: vi.fn(),
        emitStroke: (command, onResult) => void gameplay.sendStroke(command).then(onResult),
        onBatchFailure: () => void room.requestFullSnapshot(),
        emitFill: vi.fn(),
      })
    })

    const pointer = { button: 0, clientX: 20, clientY: 30, pointerId: 1 } as PointerEvent
    session.pointerDown(pointer)
    session.pointerUp(pointer)

    await waitFor(() =>
      expect(fakeTransport.requests.some(({ event }) => event === EVENTS.stateResync)).toBe(true),
    )
    expect(
      fakeTransport.requests.find(({ event }) => event === EVENTS.stateResync)?.payload.reason,
    ).toBe('state_gap')
    expect(session.pendingBatches.size).toBe(0)
    expect(drawnPoints.size).toBe(0)
    expect(redraw).toHaveBeenCalledOnce()
  })
})
