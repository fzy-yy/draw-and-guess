import type { PlayerSecret, RoomSecret } from './../models.ts'
import type { ArchiveRepository, PlayerRepository } from './../repositories/index.ts'
import { type RuntimeDependencies } from './../runtime.ts'

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

  public persistGameResult(room: RoomSecret, reason: string): void {
    const game = room.game
    if (!game || !game.finalRanking) return
    const finishedAt = this.context.clock.now()
    // game_results：逐玩家最终结果（从冻结的 finalRanking 拆出）。
    const results = game.finalRanking.map((entry) => ({
      gameId: game.id,
      playerId: entry.id,
      nickname: entry.nickname,
      avatarId: entry.avatarId,
      rank: entry.rank,
      score: entry.score,
      stats: JSON.stringify(entry.stats),
    }))
    this.context.repositories.archive.saveGame(
      {
        id: game.id,
        roomId: room.id,
        startedAt: game.startedAt,
        finishedAt,
        totalRounds: game.totalRounds,
        finalRanking: JSON.stringify(game.finalRanking),
        reason,
      },
      results,
    )
  }
}
