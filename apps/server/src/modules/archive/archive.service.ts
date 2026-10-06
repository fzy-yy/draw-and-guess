/**
 * 战报归档领域服务。
 *
 * 遵循《后端架构规范》R3.2：
 * 领域层只处理业务规则与流程编排，不感知 HTTP 或 Socket.IO 协议，
 * 依赖通过构造函数显式注入 ArchiveRepository。
 */
import type { RuntimeLogger } from '../../core/errors.ts'
import { SILENT_LOGGER } from '../../core/errors.ts'
import type { GameArchiveRecord, GameResultRecord } from './archive.model.ts'
import type { ArchiveRepository } from './archive.repository.ts'

/**
 * 战报归档服务。
 */
export class ArchiveService {
  constructor(
    private readonly repository: ArchiveRepository,
    private readonly logger: RuntimeLogger = SILENT_LOGGER,
  ) {}

  /**
   * 归档一场已结束的对局。
   *
   * @param archive 对局总战报
   * @param results 成员战绩列表
   * @returns 是否归档成功
   */
  archiveGame(archive: GameArchiveRecord, results: GameResultRecord[]): boolean {
    try {
      this.repository.saveGame(archive, results)
      return true
    } catch (error) {
      this.logger.error(
        {
          roomId: archive.roomId,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        '战绩落盘失败，已保障结算广播正常进行',
      )
      return false
    }
  }
}
