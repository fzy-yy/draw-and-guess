import type {
  GameView,
  RelayGameView,
  RelayViewPhase,
  RoomMember,
  RoomPhase,
  RoomSnapshot,
} from '@draw-guess/shared'

export const HOST_ID = '00000000-0000-4000-8000-000000000001'
export const GUEST_ID = '00000000-0000-4000-8000-000000000002'
export const ROOM_ID = '00000000-0000-4000-8000-000000000003'
export const GAME_ID = '00000000-0000-4000-8000-000000000004'
export const ROUND_ID = '00000000-0000-4000-8000-000000000005'
export const STEP_ID = '00000000-0000-4000-8000-000000000006'

function member(id: string, nickname: string, isHost: boolean, isDrawer: boolean): RoomMember {
  return {
    id,
    nickname,
    avatarId: isHost ? '01' : '02',
    status: 'playing',
    seatIndex: isHost ? 0 : 1,
    seatColor: isHost ? 'blue' : 'green',
    ready: false,
    score: isHost ? 20 : 10,
    isHost,
    isDrawer,
    guessed: false,
    rematchReady: false,
    leftGame: false,
    connection: 'online',
    stats: { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 },
  }
}

export function createRoomFixture(
  phase: RoomPhase = 'drawing',
  gamePatch: Partial<GameView> = {},
): RoomSnapshot {
  const game: GameView = {
    gameId: GAME_ID,
    roundId: ROUND_ID,
    currentRound: 1,
    totalRounds: 2,
    drawerId: HOST_ID,
    phaseStartedAt: 1_000,
    phaseEndsAt: 61_000,
    answerMask: '＿ ＿',
    answer: '苹果',
    strokes: [],
    undoneStrokeIds: [],
    lastSequence: -1,
    drawingRevision: 0,
    messages: [],
    ...gamePatch,
  }
  return {
    id: ROOM_ID,
    name: '测试房间',
    hostId: HOST_ID,
    visibility: 'public',
    gameMode: 'classic',
    phase,
    stateVersion: 1,
    settings: {
      roundsPerPlayer: 1,
      drawSeconds: 60,
      chooseSeconds: 10,
      optionCount: 3,
      showWordLength: true,
      progressiveHints: true,
      allowPlayerInvite: true,
      allowWordReroll: true,
      allowCustomWord: false,
      allowNearMissHint: true,
      allowCanvasReactions: true,
      allowRoundReplay: true,
      relayChooseSeconds: 20,
      relayDrawSeconds: 90,
      relayGuessSeconds: 45,
    },
    members: [member(HOST_ID, '房主', true, true), member(GUEST_ID, '猜词者', false, false)],
    selectedWordCount: 60,
    totalWordCount: 60,
    vocabularyPackageIds: [],
    vocabularyPackageNames: [],
    game,
  }
}

/**
 * 接龙快照夹具：房间为接龙模式（**没有**经典 `game` 字段，数据全在 `relay` 视图里），
 * 并带一份最小接龙视图；`relayPatch` / `roomPatch` 用于按用例定制幕、步骤与提交状态。
 */
export function createRelayRoomFixture(
  phase: RelayViewPhase = 'relay_draw',
  relayPatch: Partial<RelayGameView> = {},
  roomPatch: Partial<RoomSnapshot> = {},
): RoomSnapshot {
  const relay: RelayGameView = {
    phase,
    currentStep: 1,
    stepId: STEP_ID,
    phaseStartedAt: 1_000,
    phaseEndsAt: 61_000,
    submitted: false,
    submittedPlayerIds: [],
    messages: [],
    ...relayPatch,
  }
  const snapshot: RoomSnapshot = {
    ...createRoomFixture(phase),
    gameMode: 'relay',
    relay,
    ...roomPatch,
  }
  // 接龙房没有经典对局视图：夹具必须与线上形状一致，否则测不出「数据源只在 relay」这条契约。
  delete snapshot.game
  return snapshot
}

/**
 * 接龙快照夹具（**带真实未来截止窗口**）：`phaseEndsAt` 换算成「现在 + 61 秒」。
 *
 * 基础夹具刻意用逻辑时间戳（`1_000` / `61_000`）供只看数值的用例断言；但作答浮层按本地校正时钟
 * 判断「本棒是否已结束」，若沿用 1970 年的截止时间，提交入口在测试里会永远置灰
 * （排查见 `.scratch/relay-mode/bug-report.md` B2）。
 */
export function createLiveRelayRoomFixture(
  phase: RelayViewPhase = 'relay_draw',
  relayPatch: Partial<RelayGameView> = {},
  roomPatch: Partial<RoomSnapshot> = {},
): RoomSnapshot {
  return createRelayRoomFixture(
    phase,
    { phaseEndsAt: Date.now() + 61_000, ...relayPatch },
    roomPatch,
  )
}
