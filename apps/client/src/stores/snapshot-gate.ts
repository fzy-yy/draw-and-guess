/**
 * 推送快照统一门禁：对「角色裁剪快照」与绘图增量在客户端做再裁决（纯函数、无 store 依赖，可独立单测）。
 *
 * 为什么需要：Socket.IO 不保证断线重连与恢复后的推送顺序，本地权威镜像必须自行
 * 拒绝旧房间、旧状态、旧对局、旧回合与画布修订倒退（服务端才是唯一裁决者，
 * 本门禁只是客户端侧的镜像一致性防线，见 docs/adr/0025-resync-module.md）。
 *
 * 三值决策 PushDecision 各自的触发场景：
 * - `accept`：载荷属于当前房间/对局/回合且修订不倒退，可直接写入本地权威镜像；
 * - `ignore`：载荷与当前上下文不同源（换房、跨对局）或版本/修订倒退，丢弃即可——
 *   最新状态会由后续有效推送覆盖；
 * - `resync`：确认本地镜像与权威之间存在缺口，仅丢弃当次载荷不足以补齐，消费侧
 *   （useRoomSync）须发起一次受限全量重同步。resync 仅由 acceptDrawingIncrement 的
 *   修订缺口/快照滞后类场景产生；acceptRoomSnapshot 不产生 resync——快照自带全量
 *   stateVersion，倒退包 ignore 即可，「本地无房间快照」时重同步入口也无从发起
 *   （需要 roomId），因此其返回类型收窄为 RoomSnapshotDecision
 *   （见 docs/adr/0041-snapshot-gate-decision-narrowing.md）。
 */
import type { RelayGameView, RoomSnapshot } from '@draw-guess/shared'

type PushDecision = 'accept' | 'ignore' | 'resync'

/**
 * 房间快照门禁的决策子集：快照的新旧裁决只有「采纳 / 丢弃」两种结果。
 * 曾声明为完整 PushDecision，导致消费侧 useRoomSync 存在一个永不可达的 resync 分支
 * （类型收窄后编译即强制删除该死分支，取舍见 docs/adr/0041-snapshot-gate-decision-narrowing.md）。
 */
type RoomSnapshotDecision = Extract<PushDecision, 'accept' | 'ignore'>

/**
 * 接龙快照的画布修订口径：一件接龙快照里最多只有一幅画布（作画棒＝自己的、猜词棒＝上家的、
 * 复盘期＝当前半场的），三者按观看者与步骤互斥，因此取任一存在者的修订即可（都没有时按 0）。
 * 接龙**零广播**（S49），本客户端自己上传的笔画会先落到本地镜像上，所以这个修订正是
 * 「快照里的画布是否被本客户端的在途提交甩在后面」的判据。
 */
function relayDrawingRevision(relay: RelayGameView): number {
  return (
    relay.ownCanvas?.drawingRevision ??
    relay.previousDrawing?.drawingRevision ??
    relay.showcase?.drawing.drawingRevision ??
    0
  )
}

/**
 * 房间快照统一门禁：拒绝旧房间、旧状态、旧对局、旧回合与画布修订倒退。
 * 相同 stateVersion 仍可接收，因为聊天/绘图等高频状态不会为每条消息增加房间版本。
 */
export function acceptRoomSnapshot(
  current: RoomSnapshot | undefined,
  incoming: RoomSnapshot,
): RoomSnapshotDecision {
  // 本地还没有任何房间快照（首次推送 / 重连后落位）：权威快照无条件采纳。
  if (!current) return 'accept'
  // 载荷不属于当前房间（换房后的迟到包 / 串房）：丢弃。
  if (incoming.id !== current.id) return 'ignore'
  // 房间状态版本倒退：乱序旧包，丢弃。
  if (incoming.stateVersion < current.stateVersion) return 'ignore'

  // 接龙分支（S60）：接龙房间没有经典 `game` 字段，改按「步骤 id + 画布修订 + 状态版本」裁决。
  // 放在经典分支之前、并在本分支内穷尽返回，经典路径因此一行不动。
  if (incoming.gameMode === 'relay') {
    const currentRelay = current.relay
    const incomingRelay = incoming.relay
    // 本地还没有接龙视图（刚进房 / 开局首包）：无镜像可倒退，采纳。
    if (!currentRelay) return 'accept'
    // 本地有接龙视图而载荷没有（接龙局已结束的回退包）：只有状态版本前进才可信。
    if (!incomingRelay) return incoming.stateVersion > current.stateVersion ? 'accept' : 'ignore'
    // 换棒（步骤 id 变化）：服务端权威已交棒，采纳新的画布与题面。
    if (incomingRelay.stepId !== currentRelay.stepId) return 'accept'
    // 同一棒内：画布修订不允许倒退，否则会用旧画布覆盖本客户端已落地的笔画。
    return relayDrawingRevision(incomingRelay) < relayDrawingRevision(currentRelay)
      ? 'ignore'
      : 'accept'
  }

  const currentGame = current.game
  const incomingGame = incoming.game
  // 本地未开局：同房间快照无论带不带对局都可采纳——本地绘图镜像为空，无缺口可言。
  if (!currentGame) return 'accept'
  // 本地在局、来的快照已无 game（对局结束/提前结束是服务端权威回退）：
  // 只有 stateVersion 前进才说明这是回退后的新权威，否则是回退前的乱序旧包。
  if (!incomingGame) return incoming.stateVersion > current.stateVersion ? 'accept' : 'ignore'
  // 同理，gameId 变化意味着新一局已开始，必须 stateVersion 前进才可信，防旧开局包覆盖新局。
  if (incomingGame.gameId !== currentGame.gameId)
    return incoming.stateVersion > current.stateVersion ? 'accept' : 'ignore'
  // 同一局内：回合序号不允许倒退。
  if (incomingGame.currentRound < currentGame.currentRound) return 'ignore'
  // roundId 换了但回合数没前进：旧回合的迟到快照，丢弃。
  if (
    incomingGame.roundId !== currentGame.roundId &&
    incomingGame.currentRound <= currentGame.currentRound
  )
    return 'ignore'
  // 同回合画布修订倒退：绘图增量落后于本地镜像，丢弃。
  if (
    incomingGame.roundId === currentGame.roundId &&
    incomingGame.drawingRevision < currentGame.drawingRevision
  )
    return 'ignore'
  return 'accept'
}

export interface DrawingIncrementMeta {
  roomId: string
  gameId: string
  roundId: string
  drawingRevision: number
}

/** 绘图增量必须属于当前房间/对局/回合，并严格接续 drawingRevision。 */
export function acceptDrawingIncrement(
  current: RoomSnapshot | undefined,
  incoming: DrawingIncrementMeta,
): PushDecision {
  const game = current?.game
  // 本地无房间快照时重同步入口无从发起（resync 需要 roomId），丢弃是裁决而非疏漏。
  if (!current) return 'ignore'
  // 房间内已开局而本地快照尚无 game：镜像落后于开局推送，须全量重同步补齐。
  if (!game) return 'resync'
  // 跨房 / 跨对局 / 跨回合的迟到增量：与当前画布上下文不同源，丢弃。
  if (incoming.roomId !== current.id) return 'ignore'
  if (incoming.gameId !== game.gameId || incoming.roundId !== game.roundId) return 'ignore'
  // 修订未前进：重复或迟到增量，丢弃。
  if (incoming.drawingRevision <= game.drawingRevision) return 'ignore'
  // 修订跳号（非严格 +1）：本地镜像缺中间增量，丢弃本次并要求全量重同步补齐。
  if (incoming.drawingRevision !== game.drawingRevision + 1) return 'resync'
  return 'accept'
}
