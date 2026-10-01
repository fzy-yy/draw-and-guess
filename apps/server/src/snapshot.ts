/**
 * 房间/玩家视图裁剪（快照组装）。
 * 所有公开数据结构都由此模块按观看者角色生成，服务端秘密字段（答案、令牌、计时、候选）绝不外泄。
 * 依赖收窄为 `SnapshotViewPort`（ADR-0021）：消费者声明自己需要的读取面，GameService 结构上
 * 满足并整实例传入；测试可直接实例化本构建器做角色×阶段穷举矩阵，无需拉起全图。
 */
import { APP_CONFIG } from './config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import {
  createAnswerMask,
  type GameView,
  type Invite,
  type PublicPlayer,
  type PublicRoom,
  type RoomPhase,
  type RoomSnapshot,
} from '@draw-guess/shared'
import { GameError } from './errors.ts'
import type { InviteSecret, PlayerSecret, RoomSecret } from './models.ts'
import type { Clock } from './runtime.ts'
import type { VocabularyStore } from './vocabulary/index.ts'
import { invalidateMemberCanvasSync } from './domain/drawing/canvas-sync.ts'
import {
  connectionStatus,
  nicknameOf,
  nominalPhaseDurationMs,
  occupiesSeat,
} from './domain/room/member-facts.ts'

/**
 * 快照构建所需的最小读取端口（消费者声明，同 ADR-0019 的窄端口哲学）。
 * 只暴露「裁剪视图需要的只读状态 + 三个跨用例判定」；GameService 的全量能力
 * （写路径、计时器、仓储）对本模块不可见——SnapshotBuilder 不可能改动权威状态，
 * 这一约束由类型而非纪律保证。
 */
export interface SnapshotViewPort {
  readonly players: ReadonlyMap<string, PlayerSecret>
  readonly rooms: ReadonlyMap<string, RoomSecret>
  readonly clock: Clock
  isPlaying(phase: RoomPhase): boolean
  getRoomVocabularyStore(room?: RoomSecret): VocabularyStore
  requirePlayer(playerId: string): PlayerSecret
}

/** 按观看者角色裁剪房间/玩家视图的构建器。 */
export class SnapshotBuilder {
  constructor(private readonly port: SnapshotViewPort) {}

  /** 为指定观看者生成裁剪后的房间快照（画家可见答案与候选词，结算阶段全员可见答案）。 */
  snapshot(
    room: RoomSecret,
    viewerId: string,
    options: { forceFull?: boolean } = {},
  ): RoomSnapshot {
    const game = room.game
    // 快照差分：若观看者已在线同步全部绘图增量（lastSyncedSeq 追平 lastSequence），
    // 快照用空数组 + strokesOmitted 标记省略画布历史，由客户端沿用本地已有笔画，降低序列化开销。
    const viewerMember = room.members.find((member) => member.playerId === viewerId)
    // 本守卫对现有调用方不可达（publisher 循环节点 / requireMembership 之后 / 入房刚占席），
    // 但它是隐私 fail-safe 且被快照穷举矩阵显式断言（非成员必须被拒绝而非降级为观众视角）——保留。
    if (!viewerMember) throw new GameError('NOT_IN_ROOM', serverStrings.errors.NOT_IN_ROOM)
    // 强制全量：作废观看者的差分游标，使本次快照必须携带完整画布历史。
    // 游标语义归本构建器所有（重连恢复 / 客户端自检修复通道），调用方不再直接改写领域状态。
    if (options.forceFull) invalidateMemberCanvasSync(viewerMember)
    // 候场/观战身份永远不能获得画家答案权限；即使异常状态下 ID 碰巧与 drawerId 相同也要裁剪。
    const viewerIsDrawer = !viewerMember.spectating && game?.drawerId === viewerId
    // game && 直接参与条件让 TS 收窄（Boolean(game) 不产生收窄，曾迫使下游写 game!）
    const canOmitStrokes =
      !!game &&
      game.strokes.length > 0 &&
      viewerMember.lastSyncedSeq !== undefined &&
      viewerMember.lastSyncedSeq >= game.lastSequence &&
      Boolean(this.port.players.get(viewerId)?.connected)
    // 暂停现场（pauseState）由 RoundMachine 成对写入：暂停态下快照按它换算冻结的截止时间
    // 与剩余毫秒；非暂停态为 undefined，直接下发权威 phaseEndsAt。
    const pauseState = room.phase === 'paused' ? game?.pauseState : undefined
    // 暂停阶段按原阶段标称总时长换算截止时间，供客户端把倒计时与进度条准确冻结在暂停时刻的
    // 数值上（标称总时长由 member-facts 单一口径给出，覆盖全部可暂停阶段含 round_result）。
    // 没有标称总时长意味着该阶段本就没有截止时间（选词阶段关闭限时）：下发哨兵 0 表达
    // 「无倒计时」，与未暂停时的口径一致。
    const pauseNominalMs =
      game && pauseState ? nominalPhaseDurationMs(pauseState.phase, game, room.settings) : undefined
    const pausedEndsAt =
      game && pauseState
        ? pauseNominalMs === undefined
          ? 0
          : game.phaseStartedAt + pauseNominalMs
        : undefined
    // 按观看者角色裁剪对局视图的敏感字段
    const gameView: GameView | undefined = game
      ? {
          gameId: game.id,
          roundId: game.roundId,
          ...(pauseState ? { phaseBeforePause: pauseState.phase } : {}),
          currentRound: game.currentRound,
          totalRounds: game.totalRounds,
          drawerId: game.drawerId,
          phaseStartedAt: game.phaseStartedAt,
          phaseEndsAt: pausedEndsAt ?? game.phaseEndsAt,
          ...(pauseState ? { pausedRemainingMs: pauseState.remainingMs } : {}),
          // 答案展示规则：结算阶段公开全文；否则按设置显示遮罩或隐藏字数
          answerMask: game.answer
            ? room.phase === 'round_result' || room.phase === 'game_result'
              ? game.answer.text
              : room.settings.showWordLength
                ? createAnswerMask(game.answer.text, game.revealedIndices)
                : serverStrings.notices.answerHidden
            : '',
          // 画家才可看到真实答案与候选词（候选词携带难度供选词星级展示，以及换一组权限标识）。
          ...(viewerIsDrawer && game.answer ? { answer: game.answer.text } : {}),
          ...(viewerIsDrawer && room.phase === 'choosing_word'
            ? {
                canReroll: !game.rerollUsed && room.settings.allowWordReroll,
                wordOptions: game.candidates.map((word) => ({
                  id: word.id,
                  text: word.text,
                })),
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
          ...(room.phase === 'game_result' && game.gameResultMinEndsAt !== undefined
            ? {
                gameResultMinEndsAt: game.gameResultMinEndsAt,
                canReturnWaiting:
                  room.hostId === viewerId && this.port.clock.now() >= game.gameResultMinEndsAt,
              }
            : {}),
        }
      : undefined
    // 词库元信息在同一快照里被三个字段引用：取一次端口结果即可（原实现连调 4 次）。
    const vocabulary = this.port.getRoomVocabularyStore(room)
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
        const player = this.port.players.get(member.playerId)
        // 在席成员资料来自玩家身份，离局成员来自冻结的 leftProfile；两者皆缺说明成员记录
        // 已损坏（身份被删除且未冻结），显式拒绝而不是下发空资料（单一守卫，等价于原双守卫）。
        const profile = member.leftProfile ?? player?.profile
        if (!profile) throw new GameError('UNAUTHORIZED', serverStrings.errors.UNAUTHORIZED)
        // 「未离开对局且身份存在」才走完整公开视图；其余用席位快照字段兜底。
        // 条件重排（!player || leftGame）把上方守卫蕴含的「!leftGame ⇒ player 存在」交给 TS 收窄，
        // 消除对 player 的非空断言，四分支真值与原实现完全一致。
        const publicPlayer =
          !player || member.leftGame
            ? {
                id: member.playerId,
                nickname: profile.nickname,
                avatarId: profile.avatarId,
                status: 'idle' as const,
              }
            : this.toPublicPlayer(player)
        return {
          ...publicPlayer,
          seatIndex: member.seatIndex,
          seatColor: APP_CONFIG.room.seatColors[member.seatIndex] ?? APP_CONFIG.room.seatColors[0],
          // 房主为隐式准备状态；非房主仍以真实 ready 字段为准。
          ready: room.hostId === member.playerId || member.ready,
          score: member.score,
          isHost: room.hostId === member.playerId,
          isDrawer: !member.spectating && game?.drawerId === member.playerId,
          guessed: Boolean(member.guessedAt),
          spectating: Boolean(member.spectating),
          waitingForNextGame: Boolean(member.waitingForNextGame),
          rematchReady: Boolean(member.rematchReady),
          leftGame: Boolean(member.leftGame),
          connection: connectionStatus(member, player),
          stats: member.stats,
        }
      }),
      selectedWordCount: room.selectedWordIds.size,
      // 同一次快照对词库 store 只取一份（旧实现连调 4 次，均为同参数重复）。
      totalWordCount: vocabulary.items.length,
      vocabularyPackageId: room.vocabularyPackageId || vocabulary.meta.id,
      vocabularyPackageName: vocabulary.meta.name || vocabulary.meta.id,
      ...(gameView ? { game: gameView } : {}),
    }
  }

  /**
   * 公开玩家视图：根据连接状态与所在房间计算在场状态。
   * isPlaying 含暂停（phase-facts 单一口径）：暂停中的房间成员在大厅显示为「游戏中」。
   */
  toPublicPlayer(player: PlayerSecret): PublicPlayer {
    const room = player.roomId ? this.port.rooms.get(player.roomId) : undefined
    const status = !player.connected
      ? 'reconnecting'
      : room
        ? this.port.isPlaying(room.phase)
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
      hostName: nicknameOf(this.port.players, room.hostId, serverStrings.notices.hostUnknown),
      playerCount: room.members.filter(occupiesSeat).length,
      maxPlayers: room.settings.maxPlayers,
      phase: room.phase,
      roundsPerPlayer: room.settings.roundsPerPlayer,
      drawSeconds: room.settings.drawSeconds,
      joinPolicy: room.settings.joinPolicy, // 大厅据此判断能否观战加入
    }
  }

  /** 公开邀请视图（不含计时器等秘密字段）与邀请者公开资料。 */
  toPublicInvite(invite: InviteSecret): Invite {
    const room = this.port.rooms.get(invite.roomId)
    const sender = this.port.requirePlayer(invite.fromPlayerId)
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
