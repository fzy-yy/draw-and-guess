import type { GameView, RoomMember, RoomPhase, RoomSnapshot } from '@draw-guess/shared'

export const HOST_ID = '00000000-0000-4000-8000-000000000001'
export const GUEST_ID = '00000000-0000-4000-8000-000000000002'
export const ROOM_ID = '00000000-0000-4000-8000-000000000003'
export const GAME_ID = '00000000-0000-4000-8000-000000000004'
export const ROUND_ID = '00000000-0000-4000-8000-000000000005'

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
    spectating: false,
    waitingForNextGame: false,
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
    phase,
    stateVersion: 1,
    settings: {
      maxPlayers: 6,
      roundsPerPlayer: 1,
      drawSeconds: 60,
      chooseSeconds: 10,
      optionCount: 3,
      showWordLength: true,
      progressiveHints: true,
      guessBaseScore: 100,
      extraGuessSeconds: 0,
      allowPlayerInvite: true,
      allowPause: true,
      allowWordReroll: true,
      joinPolicy: 'spectate',
    },
    members: [member(HOST_ID, '房主', true, true), member(GUEST_ID, '猜词者', false, false)],
    selectedWordCount: 60,
    totalWordCount: 60,
    game,
  }
}
