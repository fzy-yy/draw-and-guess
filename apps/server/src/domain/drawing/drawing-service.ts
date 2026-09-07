import { APP_CONFIG } from '../../../../../config/index.ts'
import { serverStrings } from '../../../../../string/index.ts'
import {
  normalizeHexColor,
  type FillCommand,
  type FillPush,
  type Stroke,
  type StrokeAck,
  type StrokePush,
} from '@draw-guess/shared'
import { GameError } from '../../errors.ts'
import type { GameSecret, PlayerSecret, RoomSecret } from '../../models.ts'
import { enforceEventRate } from '../../rate-limit.ts'
import type { Clock } from '../../runtime.ts'

export interface DrawingContext {
  clock: Clock
  getSession(
    playerId: string,
    roundId: string,
  ): {
    player: PlayerSecret
    room: RoomSecret
    game: GameSecret
  }
  emitRoom(roomId: string): void
  publishStroke(payload: StrokePush): void
  publishFill(payload: FillPush): void
}

/** 绘图命令用例：唯一负责笔画、填充、撤销、重做、清空和预算。 */
export class DrawingService {
  constructor(private readonly context: DrawingContext) {}

  private discardUndone(game: GameSecret): void {
    if (!game.undoneStrokeIds.length) return
    const undone = new Set(game.undoneStrokeIds)
    for (const command of game.strokes) {
      if (undone.has(command.id))
        game.strokePointTotal -= command.kind === 'stroke' ? command.points.length : 1
    }
    game.strokes = game.strokes.filter((command) => !undone.has(command.id))
    game.undoneStrokeIds = []
  }

  private trimHistory(game: GameSecret): void {
    if (game.strokes.length <= APP_CONFIG.drawing.maxHistoryCommands) return
    const dropped = game.strokes.shift()
    if (dropped) game.strokePointTotal -= dropped.kind === 'stroke' ? dropped.points.length : 1
  }

  addStroke(playerId: string, roundId: string, stroke: Stroke): StrokeAck {
    const { player, room, game } = this.context.getSession(playerId, roundId)
    enforceEventRate(player, 'draw', this.context.clock)
    if (stroke.sequence <= game.lastSequence)
      throw new GameError('STALE_DRAW_EVENT', serverStrings.errors.STALE_DRAW_EVENT_STROKE)
    const color = normalizeHexColor(stroke.color)
    if (
      !color ||
      stroke.width < APP_CONFIG.drawing.width.min ||
      stroke.width > APP_CONFIG.drawing.width.max
    )
      throw new GameError('INVALID_DRAW_STYLE', serverStrings.errors.INVALID_DRAW_STYLE)

    this.discardUndone(game)
    const existing = game.strokes.find(
      (candidate): candidate is Stroke => candidate.kind === 'stroke' && candidate.id === stroke.id,
    )
    if (existing) {
      if (
        existing.tool !== stroke.tool ||
        existing.width !== stroke.width ||
        existing.color !== color ||
        stroke.startPointIndex !== existing.points.length
      )
        throw new GameError('INVALID_DRAW_STYLE', serverStrings.errors.INVALID_DRAW_STYLE)
    } else if (stroke.startPointIndex !== undefined && stroke.startPointIndex !== 0) {
      throw new GameError('INVALID_DRAW_STYLE', serverStrings.errors.INVALID_DRAW_STYLE)
    }

    const nextPointTotal = game.strokePointTotal + stroke.points.length
    if (
      nextPointTotal > APP_CONFIG.drawing.maxPointsPerRound ||
      (existing?.points.length ?? 0) + stroke.points.length > APP_CONFIG.drawing.maxPointsPerStroke
    )
      throw new GameError('DRAW_BUDGET_EXCEEDED', serverStrings.errors.DRAW_BUDGET_EXCEEDED)

    game.lastSequence = stroke.sequence
    game.strokePointTotal = nextPointTotal
    if (existing) {
      existing.points.push(...stroke.points)
      existing.sequence = stroke.sequence
    } else {
      game.strokes.push({ ...stroke, color, points: [...stroke.points] })
      this.trimHistory(game)
    }
    game.drawingRevision += 1
    room.members.forEach((member) => (member.lastSyncedSeq = game.lastSequence))
    this.context.publishStroke({
      roomId: room.id,
      gameId: game.id,
      roundId,
      stroke: { ...stroke, color, points: stroke.points },
      drawingRevision: game.drawingRevision,
    })
    return {
      strokeId: stroke.id,
      pointCount: existing ? existing.points.length : stroke.points.length,
      drawingRevision: game.drawingRevision,
      remainingBudget: Math.max(0, APP_CONFIG.drawing.maxPointsPerRound - game.strokePointTotal),
    }
  }

  addFill(playerId: string, roundId: string, fill: FillCommand): void {
    const { player, room, game } = this.context.getSession(playerId, roundId)
    enforceEventRate(player, 'draw', this.context.clock)
    if (fill.sequence <= game.lastSequence)
      throw new GameError('STALE_DRAW_EVENT', serverStrings.errors.STALE_DRAW_EVENT_FILL)
    const color = normalizeHexColor(fill.color)
    if (!color) throw new GameError('INVALID_FILL', serverStrings.errors.INVALID_FILL)
    this.discardUndone(game)
    if (game.strokePointTotal + 1 > APP_CONFIG.drawing.maxPointsPerRound)
      throw new GameError('DRAW_BUDGET_EXCEEDED', serverStrings.errors.DRAW_BUDGET_EXCEEDED)
    game.lastSequence = fill.sequence
    game.strokePointTotal += 1
    game.strokes.push({ ...fill, color })
    this.trimHistory(game)
    game.drawingRevision += 1
    room.members.forEach((member) => (member.lastSyncedSeq = game.lastSequence))
    this.context.publishFill({
      roomId: room.id,
      gameId: game.id,
      roundId,
      fill: { ...fill, color },
      drawingRevision: game.drawingRevision,
    })
  }

  undo(playerId: string, roundId: string): void {
    const { player, room, game } = this.context.getSession(playerId, roundId)
    enforceEventRate(player, 'draw', this.context.clock)
    const undone = new Set(game.undoneStrokeIds)
    const target = [...game.strokes].reverse().find((command) => !undone.has(command.id))
    if (!target) return
    game.undoneStrokeIds.push(target.id)
    game.drawingRevision += 1
    this.context.emitRoom(room.id)
  }

  redo(playerId: string, roundId: string): void {
    const { player, room, game } = this.context.getSession(playerId, roundId)
    enforceEventRate(player, 'draw', this.context.clock)
    if (!game.undoneStrokeIds.length) return
    game.undoneStrokeIds.pop()
    game.drawingRevision += 1
    this.context.emitRoom(room.id)
  }

  clear(playerId: string, roundId: string): void {
    const { player, room, game } = this.context.getSession(playerId, roundId)
    enforceEventRate(player, 'draw', this.context.clock)
    if (!game.strokes.length && !game.undoneStrokeIds.length) return
    game.strokes = []
    game.strokePointTotal = 0
    game.undoneStrokeIds = []
    game.lastSequence += 1
    game.drawingRevision += 1
    this.context.emitRoom(room.id)
  }
}
