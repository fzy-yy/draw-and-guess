import type { PlayerSecret, RoomSecret } from '../models.ts'
import type { ArchiveRepository, PlayerRepository } from '../repositories/index.ts'
import { type RuntimeDependencies } from '../runtime.ts'

/** 仅暴露本用例需要的数据与副作用端口；由应用层连接跨用例动作。 */
export interface RoomPersistenceCoordinatorContext {
  clock: RuntimeDependencies['clock']
  repositories: {
    players: Pick<PlayerRepository, 'upsert'>
    archive: Pick<ArchiveRepository, 'saveGame'>
  }
}

export class RoomPersistenceCoordinator {
  constructor(private readonly context: RoomPersistenceCoordinatorContext) {}
  public persistPlayer(player: PlayerSecret): void {
    this.context.repositories.players.upsert({
      id: player.id,
      tokenDigest: player.tokenDigest,
      nickname: player.profile.nickname,
      avatarId: player.profile.avatarId,
      discoverable: player.preferences.discoverable,
      acceptsInvites: player.preferences.acceptsInvites,
      connected: player.connected,
      joinedAt: player.joinedAt,
      disconnectedAt: player.disconnectedAt,
    })
  }

  /**
   * 把整局战报落盘（两种模式共用入口，按 `gameMode` 取各自的冻结榜单）：
   * - 经典：`room.game.finalRanking`，回合数为真实回合数；
   * - 接龙：`room.relay.finalRanking`（只有排名 / 分数 / 接龙统计），`total_rounds` 记本局链数
   *   （每条链是接龙里唯一「展示 + 投票」的结算单位），链明细 / 画布 / 投票一律不落盘（S25 / S59）。
   * 两种模式都写 `mode` 列，方便历史战报区分玩法。
   * 空榜单不写归档：全员资料缺失（极端注销时序）时归档没有任何玩家结果，只会制造空战报噪音。
   */
  public persistGameResult(room: RoomSecret, reason: string): void {
    const isRelay = room.gameMode === 'relay'
    const game = room.game
    const relay = room.relay
    const finalRanking = isRelay ? relay?.finalRanking : game?.finalRanking
    const id = isRelay ? relay?.id : game?.id
    const startedAt = isRelay ? relay?.startedAt : game?.startedAt
    if (!finalRanking || finalRanking.length === 0 || !id || startedAt === undefined) return
    const finishedAt = this.context.clock.now()
    // game_results：逐玩家最终结果（从冻结的 finalRanking 拆出）。
    const results = finalRanking.map((entry) => ({
      gameId: id,
      playerId: entry.id,
      nickname: entry.nickname,
      avatarId: entry.avatarId,
      rank: entry.rank,
      score: entry.score,
      // 接龙榜没有经典口径的统计（猜中次数等），落盘记空对象占位以保持两模式行结构一致
      stats: JSON.stringify('stats' in entry ? entry.stats : {}),
    }))
    this.context.repositories.archive.saveGame(
      {
        id,
        roomId: room.id,
        startedAt,
        finishedAt,
        totalRounds: isRelay ? (relay?.chains.length ?? 0) : (game?.totalRounds ?? 0),
        finalRanking: JSON.stringify(finalRanking),
        reason,
        mode: room.gameMode,
      },
      results,
    )
  }
}
