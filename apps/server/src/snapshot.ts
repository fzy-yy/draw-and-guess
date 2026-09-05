/**
 * 房间/玩家视图裁剪（快照组装）。
 * 所有公开数据结构都由此模块按观看者角色生成，服务端秘密字段（答案、令牌、计时、候选）绝不外泄；
 * 与 GameService 组合使用，方便对“角色裁剪规则”独立测试。
 */
import { APP_CONFIG } from '../../../config/index.ts'
import { serverStrings } from '../../../string/index.ts'
import {
  createAnswerMask,
  type GameView,
  type Invite,
  type PublicPlayer,
  type PublicRoom,
  type RoomSnapshot,
} from '@draw-guess/shared'
import { GameError } from './errors.ts'
import type { InviteSecret, PlayerSecret, RoomSecret } from './models.ts'
import type { GameService } from './game-service.ts'

/** 按观看者角色裁剪房间/玩家视图的构建器。 */
export class SnapshotBuilder {
  constructor(private readonly service: GameService) {}

  /** 为指定观看者生成裁剪后的房间快照（画家可见答案与候选词，结算阶段全员可见答案）。 */
  snapshot(room: RoomSecret, viewerId: string): RoomSnapshot {
    const game = room.game
    const viewerIsDrawer = game?.drawerId === viewerId
    // 快照差分：若观看者已在线同步全部绘图增量（lastSyncedSeq 追平 lastSequence），
    // 快照用空数组 + strokesOmitted 标记省略画布历史，由客户端沿用本地已有笔画，降低序列化开销。
    const viewerMember = room.members.find((member) => member.playerId === viewerId)
    if (!viewerMember) throw new GameError('NOT_IN_ROOM', serverStrings.errors.NOT_IN_ROOM)
    const canOmitStrokes =
      Boolean(game) &&
      game!.strokes.length > 0 &&
      viewerMember?.lastSyncedSeq !== undefined &&
      viewerMember.lastSyncedSeq >= game!.lastSequence &&
      Boolean(this.service.players.get(viewerId)?.connected)
    // 按观看者角色裁剪对局视图的敏感字段
    const gameView: GameView | undefined = game
      ? {
          gameId: game.id,
          roundId: game.roundId,
          ...(game.phaseBeforePause ? { phaseBeforePause: game.phaseBeforePause } : {}),
          currentRound: game.currentRound,
          totalRounds: game.totalRounds,
          drawerId: game.drawerId,
          phaseStartedAt: game.phaseStartedAt,
          // 暂停阶段：下发冻结的剩余毫秒 pausedRemainingMs，并换算阶段总时长维持稳定的截止时间，
          // 供客户端将倒计时与进度条准确冻结在暂停时刻的数值上（而非扣减至 0）。
          phaseEndsAt:
            room.phase === 'paused'
              ? game.phaseStartedAt +
                (game.phaseBeforePause === 'drawing'
                  ? game.roundDurationMs
                  : game.phaseBeforePause === 'choosing_word'
                    ? room.settings.chooseSeconds * 1_000
                    : (game.pausedRemainingMs ?? 0))
              : game.phaseEndsAt,
          ...(room.phase === 'paused' ? { pausedRemainingMs: game.pausedRemainingMs ?? 0 } : {}),
          // 答案展示规则：结算阶段公开全文；否则按设置显示遮罩或隐藏字数
          answerMask: game.answer
            ? room.phase === 'round_result' || room.phase === 'game_result'
              ? game.answer.text
              : room.settings.showWordLength
                ? createAnswerMask(game.answer.text, game.revealedIndices)
                : serverStrings.notices.answerHidden
            : '',
          // 画家才可看到真实答案、真实分类与候选词（候选词携带难度供选词星级展示，以及换一组权限标识）
          ...(viewerIsDrawer && game.answer
            ? { answer: game.answer.text, wordCategory: game.answer.category }
            : {}),
          ...(viewerIsDrawer && room.phase === 'choosing_word'
            ? {
                canReroll: !game.rerollUsed && (room.settings.allowWordReroll ?? true),
                wordOptions: game.candidates.map((word) => ({
                  id: word.id,
                  text: word.text,
                  difficulty: word.difficulty,
                })),
              }
            : {}),
          // 已揭示的结构化提示：词库单分类即提示，揭示时下发词条分类；
          // 客户端只渲染首值，且对全体猜词者一致。
          ...(game.answer && game.revealedHintCount > 0
            ? {
                revealedHints: game.hintOrder
                  .slice(0, game.revealedHintCount)
                  .map(() => game.answer!.category)
                  .filter((hint): hint is string => hint !== ''),
              }
            : {}),
          strokes: canOmitStrokes ? [] : game.strokes,
          ...(canOmitStrokes ? { strokesOmitted: true } : {}),
          undoneStrokeIds: game.undoneStrokeIds,
          lastSequence: game.lastSequence, // 下发已接受的最大绘图序号，供重连客户端续起
          drawingRevision: game.drawingRevision,
          messages: game.messages.slice(-APP_CONFIG.ui.recentMessageCount),
          ...(game.roundResult ? { roundResult: game.roundResult } : {}),
          ...(game.finalRanking ? { finalRanking: game.finalRanking } : {}),
        }
      : undefined
    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      visibility: room.visibility,
      // 房间码仅向当前私密房房主显示，普通成员和大厅快照均不可见。
      ...(room.visibility === 'private' && room.hostId === viewerId && room.privateJoinCode
        ? { privateJoinCode: room.privateJoinCode }
        : {}),
      phase: room.phase,
      stateVersion: room.stateVersion,
      settings: room.settings,
      // 成员视图：公开身份 + 局内状态，注意不包含服务端秘密字段
      members: room.members.map((member) => {
        const player = this.service.players.get(member.playerId)
        if (!member.leftGame && !player)
          throw new GameError('UNAUTHORIZED', serverStrings.errors.UNAUTHORIZED)
        const profile = member.leftProfile ?? player?.profile
        if (!profile) throw new GameError('UNAUTHORIZED', serverStrings.errors.UNAUTHORIZED)
        const publicPlayer = member.leftGame
          ? {
              id: member.playerId,
              nickname: profile.nickname,
              avatarId: profile.avatarId,
              status: 'idle' as const,
            }
          : this.toPublicPlayer(player!)
        return {
          ...publicPlayer,
          seatIndex: member.seatIndex,
          seatColor: APP_CONFIG.room.seatColors[member.seatIndex] ?? APP_CONFIG.room.seatColors[0],
          // 房主为隐式准备状态；非房主仍以真实 ready 字段为准。
          ready: room.hostId === member.playerId || member.ready,
          score: member.score,
          isHost: room.hostId === member.playerId,
          isDrawer: game?.drawerId === member.playerId,
          guessed: Boolean(member.guessedAt),
          spectating: Boolean(member.spectating),
          leftGame: Boolean(member.leftGame),
          connection: member.leftGame ? 'left' : player!.connected ? 'online' : 'reconnecting',
          stats: member.stats,
        }
      }),
      selectedWordCount: room.selectedWordIds.size,
      totalWordCount: this.service.vocabulary.items.length,
      ...(gameView ? { game: gameView } : {}),
    }
  }

  /** 公开玩家视图：根据连接状态与所在房间计算在场状态。 */
  toPublicPlayer(player: PlayerSecret): PublicPlayer {
    const room = player.roomId ? this.service.rooms.get(player.roomId) : undefined
    const status = !player.connected
      ? 'reconnecting'
      : room
        ? this.service.isPlaying(room.phase)
          ? 'playing'
          : 'in_room'
        : 'idle'
    return {
      id: player.id,
      nickname: player.profile.nickname,
      avatarId: player.profile.avatarId,
      status,
      // 私密房内部 UUID 不出现在大厅玩家资料中，避免绕过房间码入口。
      ...(room?.visibility === 'public' ? { roomId: room.id } : {}),
    }
  }

  /** 大厅行：只接受公开房并暴露无敏感信息的摘要字段。
   * 注意：presenceSnapshot 已先按 visibility 过滤，本分支是防御性兜底（公开房转私密等极端时序）。 */
  toPublicRoom(room: RoomSecret): PublicRoom {
    if (room.visibility !== 'public')
      throw new GameError('PRIVATE_ROOM_HIDDEN', serverStrings.errors.ROOM_NOT_FOUND)
    return {
      visibility: 'public',
      id: room.id,
      name: room.name,
      hostName:
        this.service.players.get(room.hostId)?.profile.nickname ??
        serverStrings.notices.hostUnknown,
      playerCount: room.members.filter((member) => !member.leftGame).length,
      maxPlayers: room.settings.maxPlayers,
      phase: room.phase,
      roundsPerPlayer: room.settings.roundsPerPlayer,
      drawSeconds: room.settings.drawSeconds,
      joinPolicy: room.settings.joinPolicy, // 大厅据此判断能否观战加入
    }
  }

  /** 公开邀请视图（不含计时器等秘密字段）与邀请者公开资料。 */
  toPublicInvite(invite: InviteSecret): Invite {
    const room = this.service.rooms.get(invite.roomId)
    const sender = this.service.requirePlayer(invite.fromPlayerId)
    if (!room) throw new GameError('ROOM_NOT_FOUND', serverStrings.errors.INVITE_ROOM_CLOSED)
    return {
      id: invite.id,
      roomId: room.id,
      roomName: room.name,
      from: this.toPublicPlayer(sender),
      expiresAt: invite.expiresAt,
    }
  }
}
