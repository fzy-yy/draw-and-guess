/**
 * 成员事实单一口径（纯函数）。
 *
 * 为什么存在：房间内「谁还在席、谁可玩、谁在线、谁能进下一局、谁进最终榜单」这类判断，
 * 曾在 scoring / round-machine / room-membership-service / game-service / snapshot 等 12+ 处
 * 各写一遍内联过滤器；改一处忘一处就会造成隐性缺陷。本模块把每种语义收敛成一个具名谓词，
 * 并派生集合选择器与计数，调用方只按语义调用（见 docs/adr/0023-member-facts-single-source.md）。
 *
 * 边界：只做只读判定，绝不修改成员；连通性一律经显式 `isOnline` 入参注入，
 * 因此模块自身保持纯函数、可脱离房间与 Socket 独立单测。
 */
import type { RoomPhase, RoomSettings } from '@draw-guess/shared'
import { APP_CONFIG } from '../../config/index.ts'
import type { GameSecret, MemberState, PlayerSecret, RoomSecret } from '../../models.ts'

/** 只依赖成员列表的窄入参：房间级选择器与计数只需要这一项。 */
type MemberList = Pick<RoomSecret, 'members'>

/** 玩家连通性查询：调用方注入（生产为 `players.get(id)?.connected`）。 */
export type OnlineLookup = (playerId: string) => boolean

/**
 * 构造连通性查询闭包：map 的键空间与 `connected` 语义只在此定义一次，
 * 供 game-service / round-machine / room-membership-service 共用，避免同一 lambda 内联三处。
 */
export function createOnlineLookup(
  players: ReadonlyMap<string, Pick<PlayerSecret, 'connected'>>,
): OnlineLookup {
  return (playerId) => players.get(playerId)?.connected === true
}

/**
 * 阶段是否已到期。`phaseEndsAt` 为 0 是暂停期的哨兵（暂停时冻结截止时间），此时不算到期；
 * 与阶段白名单配合使用，调用方传入当前时钟毫秒。
 */
export function isPhaseExpired(game: Pick<GameSecret, 'phaseEndsAt'>, now: number): boolean {
  return game.phaseEndsAt > 0 && now >= game.phaseEndsAt
}

/**
 * 取玩家昵称，身份缺失时回退调用方给定的文案。
 * 各调用点的回退语义不同（房主兜底、系统通知兜底等），故回退文案由调用方决定而不写死。
 */
export function nicknameOf(
  players: ReadonlyMap<string, Pick<PlayerSecret, 'profile'>>,
  playerId: string,
  fallback: string,
): string {
  return players.get(playerId)?.profile.nickname ?? fallback
}

/**
 * 是否仍占用房间席位（未主动离局）。
 * 离局成员会作为占位保留在 members 中用于展示成绩卡，因此「占席」比「可玩」更宽；
 * 容量、缩容下限与大厅人数都用它。
 */
export function occupiesSeat(member: MemberState): boolean {
  return !member.leftGame
}

/**
 * 是否可玩成员：非观战且未离局。
 * 观战者与离局者都不参与准备、画家轮换、猜词与计分。
 */
export function isActivePlayer(member: MemberState): boolean {
  return !member.spectating && !member.leftGame
}

/**
 * 是否在线可玩：可玩且当前连接可用。
 * 用于房主迁移、选下一位画家、开局全员在线校验与自动暂停计数等需要「即时在线」的场景。
 */
export function isOnlinePlayer(member: MemberState, isOnline: OnlineLookup): boolean {
  return isActivePlayer(member) && isOnline(member.playerId)
}

/**
 * 是否下一局有效成员：非离局，且要么可玩、要么已登记候场。
 * 纯观战者不算有效成员；离局者即便登记过也不计入。
 */
export function isRematchEligible(member: MemberState): boolean {
  return !member.leftGame && (!member.spectating || member.waitingForNextGame === true)
}

/**
 * 是否进入最终榜单：排除观战者，但**保留离局者**。
 * 已公布的成绩属于本局历史，不随成员离开席位而消失（leaving 时冻结的 leftProfile 正是为展示成绩卡）。
 */
export function isRankedMember(member: MemberState): boolean {
  return !member.spectating
}

/** 成员连接三态：离局或缺身份为 left，在线为 online，否则为重连中。 */
export function connectionStatus(
  member: MemberState,
  player: Pick<PlayerSecret, 'connected'> | undefined,
): 'left' | 'online' | 'reconnecting' {
  if (member.leftGame || !player) return 'left'
  return player.connected ? 'online' : 'reconnecting'
}

/** 可玩成员集合（非观战且未离局）。 */
export function activePlayers(room: MemberList): MemberState[] {
  return room.members.filter(isActivePlayer)
}

/** 在线可玩成员集合。 */
export function onlinePlayers(room: MemberList, isOnline: OnlineLookup): MemberState[] {
  return room.members.filter((member) => isOnlinePlayer(member, isOnline))
}

/** 下一局有效成员集合（候场者算数，纯观战不算）。 */
export function rematchEligibleMembers(room: MemberList): MemberState[] {
  return room.members.filter(isRematchEligible)
}

/** 最终榜单成员集合（排除观战、保留离局者）。 */
export function rankedMembers(room: MemberList): MemberState[] {
  return room.members.filter(isRankedMember)
}

/**
 * 本回合猜词者全集：可玩且非画家。
 * 回合计分用它——含已掉线者，只认「是否猜中」，因此猜中后掉线不取消得分；
 * 回合结束判定用 onlineGuessers（掉线者不阻塞收回合），两者不要互换。
 */
export function activeGuessers(room: MemberList, drawerId: string): MemberState[] {
  return room.members.filter((member) => isActivePlayer(member) && member.playerId !== drawerId)
}

/** 本回合在线猜词者：在线可玩且非画家，用于判「有效猜词者全部猜中即结束回合」。
 * 与 activeGuessers 的差别是刻意保留的：回合计分认「是否猜中」（掉线不取消得分），
 * 回合结束判定认「在线」（掉线者不会让回合卡死）——不要在两处互换使用。 */
export function onlineGuessers(
  room: MemberList,
  drawerId: string,
  isOnline: OnlineLookup,
): MemberState[] {
  return room.members.filter(
    (member) => isOnlinePlayer(member, isOnline) && member.playerId !== drawerId,
  )
}

/** 可玩成员数（非观战且未离局）。 */
export function countActivePlayers(room: MemberList): number {
  return activePlayers(room).length
}

/** 在线可玩成员数（自动暂停判定用）。 */
export function countOnlinePlayers(room: MemberList, isOnline: OnlineLookup): number {
  return onlinePlayers(room, isOnline).length
}

/**
 * 阶段标称总时长（毫秒）：暂停/恢复与暂停快照需按原阶段总时长重建截止时间。
 * 覆盖全部可暂停阶段：drawing（本回合实际作画时长）、choosing_word（房间选词秒数）、
 * round_result（全局结算展示时长）。round_result 若缺标称值，暂停快照会把总时长误算为
 * 冻结剩余量，使客户端进度条被钉死在 100%。其余阶段（starting/game_result 等）不可暂停，
 * 无标称值，返回 undefined。
 * 选词阶段关闭限时（allowChooseTimeLimit=false）时同样返回 undefined——
 * 该阶段本就没有截止时间，调用方据此保持 `phaseEndsAt = 0` 哨兵而不是重建倒计时。
 */
export function nominalPhaseDurationMs(
  phase: RoomPhase | undefined,
  game: Pick<GameSecret, 'roundDurationMs'>,
  settings: Pick<RoomSettings, 'chooseSeconds' | 'allowChooseTimeLimit'> &
    Partial<Pick<RoomSettings, 'allowRoundReplay'>>,
): number | undefined {
  if (phase === 'drawing') return game.roundDurationMs
  if (phase === 'choosing_word')
    return settings.allowChooseTimeLimit ? settings.chooseSeconds * 1_000 : undefined
  if (phase === 'round_result') {
    const replayMs = settings.allowRoundReplay
      ? (APP_CONFIG.game.roundReplaySeconds + APP_CONFIG.game.roundReplayPauseSeconds) * 1_000
      : 0
    return replayMs + APP_CONFIG.game.roundResultSeconds * 1_000
  }
  return undefined
}

/**
 * 空成员统计的构造口径：新局与回到等待阶段的重置都从这里取值。
 * 此前同一结构字面量在 round-machine（beginGame/setWaiting）与 room-membership-service
 * 各写一份，新增统计字段时漏改任一处就会产生跨局脏数据。
 */
export function createEmptyMemberStats(): MemberState['stats'] {
  return { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 }
}
