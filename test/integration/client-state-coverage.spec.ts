import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EVENTS, type Ack, type Stroke } from '@draw-guess/shared'
import { useRoomSync } from '@/composables/useRoomSync'
import { useGameplayStore } from '@/stores/gameplay'
import { useLobbyStore } from '@/stores/lobby'
import { useProfileStore } from '@/stores/profile'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { socket } from '@/stores/socket'
import { useVocabularyStore } from '@/stores/vocabulary'
import {
  GAME_ID,
  GUEST_ID,
  HOST_ID,
  ROOM_ID,
  ROUND_ID,
  createRoomFixture,
} from '../client/room-fixture'

type SocketTimeoutResult = ReturnType<typeof socket.timeout>

function mockAck(
  responder: (event: string, payload: Record<string, unknown>) => Ack<unknown>,
): void {
  vi.spyOn(socket, 'timeout').mockImplementation(
    () =>
      ({
        emitWithAck: (event: string, payload: Record<string, unknown>) =>
          Promise.resolve(responder(event, payload)),
      }) as SocketTimeoutResult,
  )
}

function stroke(sequence: number, startPointIndex = 0): Stroke {
  return {
    kind: 'stroke',
    id: '00000000-0000-4000-8000-000000000006',
    tool: 'pen',
    color: '#1F2937',
    width: 5,
    points: [{ x: sequence / 10, y: sequence / 10 }],
    sequence,
    startPointIndex,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  ;(socket as { connected: boolean }).connected = true
})

afterEach(() => {
  ;(socket as { connected: boolean }).connected = false
})

describe('Session 权威恢复', () => {
  it('恢复令牌成功时原子更新身份、资料和房间回调', async () => {
    const recoveryToken = 'a'.repeat(32)
    localStorage.setItem(
      'draw-and-guess-profile-v1',
      JSON.stringify({ nickname: '旧昵称', avatarId: '01', recoveryToken }),
    )
    const restoredRoom = createRoomFixture()
    mockAck((event, payload) => {
      expect(event).toBe(EVENTS.sessionRegister)
      return {
        ok: true,
        requestId: String(payload.requestId),
        data: {
          player: {
            id: HOST_ID,
            nickname: '恢复玩家',
            avatarId: '02',
            status: 'playing',
            roomId: ROOM_ID,
          },
          recoveryToken,
          restored: true,
          room: restoredRoom,
        },
      }
    })
    const session = useSessionStore()
    const profile = useProfileStore()
    const onRoom = vi.fn()

    await session.register(true, onRoom)

    expect(session.playerId).toBe(HOST_ID)
    expect(session.sessionState).toBe('ready')
    expect(session.page).toBe('lobby')
    expect(profile.profile).toMatchObject({ nickname: '恢复玩家', avatarId: '02', recoveryToken })
    expect(onRoom).toHaveBeenCalledWith(restoredRoom)
  })

  it('协议不匹配时锁定恢复，后续注册不再发请求', async () => {
    let calls = 0
    mockAck((_event, payload) => {
      calls += 1
      return {
        ok: false,
        requestId: String(payload.requestId),
        error: { code: 'PROTOCOL_MISMATCH', message: '版本不兼容' },
      }
    })
    const session = useSessionStore()

    await session.register()
    await session.register()

    expect(session.protocolMismatch).toBe(true)
    expect(calls).toBe(1)
  })
})

describe('Gameplay 权威增量合并', () => {
  it('追加、过期、撤销恢复与填充都按回合和序号合并', () => {
    const room = useRoomStore()
    room.room = createRoomFixture()
    const gameplay = useGameplayStore()

    gameplay.handleStrokeBatch(ROUND_ID, stroke(1))
    gameplay.handleStrokeBatch(ROUND_ID, stroke(2, 1))
    gameplay.handleStrokeBatch(ROUND_ID, stroke(1, 2))
    expect((room.room?.game?.strokes[0] as Stroke).points).toHaveLength(2)

    room.room!.game!.undoneStrokeIds = [stroke(1).id]
    gameplay.handleStrokeBatch(ROUND_ID, stroke(3, 2))
    expect(room.room?.game?.undoneStrokeIds).toEqual([])
    expect((room.room?.game?.strokes[0] as Stroke).points).toHaveLength(3)

    gameplay.handleFillCommit(ROUND_ID, {
      kind: 'fill',
      id: '00000000-0000-4000-8000-000000000007',
      point: { x: 0.5, y: 0.5 },
      color: '#EF4444',
      sequence: 4,
    })
    gameplay.handleFillCommit('old-round', {
      kind: 'fill',
      id: '00000000-0000-4000-8000-000000000008',
      point: { x: 0.1, y: 0.1 },
      color: '#EF4444',
      sequence: 5,
    })
    expect(room.room?.game?.strokes).toHaveLength(2)
    expect(gameplay.drawRevision).toBe(4)
  })

  it('不同回合的增量被忽略', () => {
    const room = useRoomStore()
    room.room = createRoomFixture()
    const gameplay = useGameplayStore()

    gameplay.handleStrokeBatch('old-round', stroke(1))

    expect(room.room.game?.strokes).toEqual([])
    expect(gameplay.drawRevision).toBe(0)
  })

  it('绘图请求保留业务拒绝类型，无当前回合时返回本地上下文失败', async () => {
    const room = useRoomStore()
    room.room = createRoomFixture()
    mockAck((_event, payload) => ({
      ok: false,
      requestId: String(payload.requestId),
      error: { code: 'DRAW_BUDGET_EXCEEDED', message: '预算超限' },
    }))
    const gameplay = useGameplayStore()

    await expect(gameplay.sendStroke(stroke(1))).resolves.toMatchObject({
      ok: false,
      failureKind: 'business',
      code: 'DRAW_BUDGET_EXCEEDED',
    })
    delete room.room.game
    await expect(gameplay.sendStroke(stroke(2))).resolves.toMatchObject({
      ok: false,
      code: 'STALE_DRAWING_CONTEXT',
    })
  })
})

describe('useRoomSync 修订门禁', () => {
  it('只合并连续修订，并为缺口请求完整权威快照', () => {
    const room = useRoomStore()
    room.room = createRoomFixture('drawing', { drawingRevision: 1 })
    const requestFullSnapshot = vi.spyOn(room, 'requestFullSnapshot').mockResolvedValue()
    const sync = useRoomSync()

    sync.onStroke(
      { roomId: ROOM_ID, gameId: GAME_ID, roundId: ROUND_ID, drawingRevision: 2 },
      stroke(2),
    )
    expect(room.room.game?.drawingRevision).toBe(2)
    expect(room.room.game?.strokes).toHaveLength(1)

    sync.onStroke(
      { roomId: ROOM_ID, gameId: GAME_ID, roundId: ROUND_ID, drawingRevision: 4 },
      stroke(4, 1),
    )
    expect(requestFullSnapshot).toHaveBeenCalledOnce()
    expect(room.room.game?.drawingRevision).toBe(2)
  })

  it('strokesOmitted 快照只在本地序号完整时复用画布', () => {
    const room = useRoomStore()
    const localStroke = stroke(3)
    room.room = createRoomFixture('drawing', {
      strokes: [localStroke],
      lastSequence: 3,
      drawingRevision: 2,
    })
    const requestFullSnapshot = vi.spyOn(room, 'requestFullSnapshot').mockResolvedValue()
    const sync = useRoomSync()

    sync.onRoomSnapshot(
      createRoomFixture('drawing', {
        strokes: [],
        strokesOmitted: true,
        lastSequence: 3,
        drawingRevision: 2,
      }),
    )
    expect(room.room.game?.strokes).toEqual([localStroke])

    sync.onRoomSnapshot(
      createRoomFixture('drawing', {
        strokes: [],
        strokesOmitted: true,
        lastSequence: 4,
        drawingRevision: 3,
      }),
    )
    expect(requestFullSnapshot).toHaveBeenCalledOnce()
  })

  it('旧房间和旧修订不会覆盖当前权威状态', () => {
    const room = useRoomStore()
    room.room = createRoomFixture()
    const sync = useRoomSync()

    sync.onStroke(
      { roomId: 'old-room', gameId: GAME_ID, roundId: ROUND_ID, drawingRevision: 1 },
      stroke(1),
    )
    sync.onRoomSnapshot({ ...createRoomFixture(), id: GUEST_ID })

    expect(room.room.id).toBe(ROOM_ID)
    expect(room.room.game?.strokes).toEqual([])
  })
})

describe('大厅、房间与词库权威请求', () => {
  it('presence、房间列表和邀请均可从请求 ack 刷新', async () => {
    const fixture = createRoomFixture()
    const invitation = {
      id: '00000000-0000-4000-8000-000000000020',
      roomId: ROOM_ID,
      roomName: fixture.name,
      from: fixture.members[0]!,
      expiresAt: Date.now() + 10_000,
    }
    mockAck((event, payload) => {
      const data =
        event === EVENTS.presenceGet
          ? { players: fixture.members, rooms: [] }
          : event === EVENTS.roomList
            ? [
                {
                  visibility: 'public',
                  id: ROOM_ID,
                  name: fixture.name,
                  hostName: '房主',
                  playerCount: 2,
                  maxPlayers: 6,
                  phase: 'waiting',
                  roundsPerPlayer: 1,
                  drawSeconds: 60,
                  joinPolicy: 'spectate',
                },
              ]
            : event === EVENTS.inviteSend
              ? invitation
              : fixture
      return { ok: true, requestId: String(payload.requestId), data }
    })
    const lobby = useLobbyStore()

    await lobby.refreshPresence()
    await lobby.refreshRooms()
    await lobby.invite(GUEST_ID)
    lobby.invites = [invitation]
    await expect(lobby.respondInvite(invitation.id, true)).resolves.toEqual(fixture)

    expect(lobby.presence.players).toHaveLength(2)
    expect(lobby.presence.rooms).toHaveLength(1)
    expect(lobby.invites).toEqual([])
  })

  it('房间 Store 覆盖成功操作、失败短路与全量重同步', async () => {
    const fixture = createRoomFixture('waiting')
    let rejectJoin = true
    mockAck((event, payload) => {
      if (event === EVENTS.roomJoin && rejectJoin) {
        rejectJoin = false
        return {
          ok: false,
          requestId: String(payload.requestId),
          error: { code: 'ROOM_NOT_FOUND', message: '房间不存在' },
        }
      }
      return { ok: true, requestId: String(payload.requestId), data: fixture }
    })
    const room = useRoomStore()

    await expect(room.joinRoom(ROOM_ID)).resolves.toBe(false)
    await expect(
      room.createRoom({ name: fixture.name, visibility: 'public', settings: fixture.settings }),
    ).resolves.toBe(true)
    await expect(room.joinRoom(ROOM_ID)).resolves.toBe(true)
    await expect(room.joinPrivateRoom('ABC123')).resolves.toBe(true)
    await room.setReady(true)
    await expect(room.updateRoomSettings({ drawSeconds: 90 })).resolves.toBe(true)
    await room.kick(GUEST_ID)
    await expect(room.transferHost(GUEST_ID)).resolves.toBe(true)

    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    await room.requestFullSnapshot()
    await room.requestFullSnapshot()
    expect(room.room?.id).toBe(ROOM_ID)
    await room.leaveRoom()
    expect(room.room).toBeUndefined()
  })

  it('词库加载、保存、切包和失效上下文只接收当前房间结果', async () => {
    const room = useRoomStore()
    room.room = { ...createRoomFixture('waiting'), vocabularyPackageId: 'p1' }
    const packages = [
      { id: 'p1', name: '基础', wordCount: 1, description: '', version: '1', updatedAt: '1' },
      { id: 'p2', name: '进阶', wordCount: 1, description: '', version: '1', updatedAt: '1' },
    ]
    mockAck((event, payload) => {
      const packageId =
        event === EVENTS.roomSelectVocabularyPackage
          ? String((payload as { packageId?: string }).packageId)
          : 'p1'
      return {
        ok: true,
        requestId: String(payload.requestId),
        data: {
          packageId,
          packages,
          items: [{ id: 'word-1', text: '苹果', aliases: [], category: '水果', difficulty: 1 }],
          selectedIds: ['word-1'],
          version: '1',
          categories: ['水果'],
        },
      }
    })
    const vocabulary = useVocabularyStore()

    await vocabulary.loadVocabulary()
    await expect(vocabulary.saveVocabulary(['word-1'])).resolves.toBe(true)
    await expect(vocabulary.selectVocabularyPackage('p2')).resolves.toBe(true)
    expect(vocabulary.vocabulary?.packageId).toBe('p2')
    vocabulary.cancelPending()
    vocabulary.clear()
    expect(vocabulary.vocabulary).toBeUndefined()
  })
})
