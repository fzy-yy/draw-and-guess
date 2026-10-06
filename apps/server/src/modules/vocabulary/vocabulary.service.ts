/**
 * 房间词库配置与选择领域服务。
 *
 * 遵循《后端架构规范》R3.2 与 R4.3：
 * 1. 负责词库包选择、词条勾选与词库快照获取；
 * 2. 状态校验：仅 waiting 阶段允许调整词库，带 stateVersion 乐观锁；
 * 3. 错误全量采用 AppError 抛出。
 */
import {
  ERROR_CODES,
  MIN_SELECTED_VOCABULARY_WORDS,
  type VocabularySnapshot,
} from '@draw-guess/shared'
import { serverStrings } from '@draw-guess/strings'
import { AppError, ConflictError, NotFoundError } from '../../core/errors.ts'
import type { RoomSecret } from '../../models.ts'
import type { VocabularyRegistry, VocabularyStore } from '../../vocabulary/index.ts'
import type { RoomEventPorts } from '../../domain/shared-ports.ts'

/**
 * 房间词库服务上下文依赖契约。
 */
export interface RoomVocabularyContext extends RoomEventPorts {
  registry: VocabularyRegistry
  getMembership(playerId: string): { room: RoomSecret }
  getHostRoom(playerId: string): RoomSecret
  getStore(room: RoomSecret): VocabularyStore
  addNotice(room: RoomSecret, text: string): void
}

/**
 * 房间词库领域服务。
 */
export class RoomVocabularyService {
  constructor(private readonly context: RoomVocabularyContext) {}

  /**
   * 获取指定玩家所在房间的当前词库快照。
   */
  get(playerId: string): VocabularySnapshot {
    const { room } = this.context.getMembership(playerId)
    const store = this.context.getStore(room)
    const packages = this.context.registry.packages
    const packageIds =
      room.vocabularyPackageIds && room.vocabularyPackageIds.length > 0
        ? room.vocabularyPackageIds
        : room.vocabularyPackageId
          ? [room.vocabularyPackageId]
          : [this.context.registry.defaultPackageId]

    return {
      packageIds,
      packages,
      items: store.items,
      selectedIds: [...room.selectedWordIds],
      version: store.version,
      collections: store.meta.collections,
    }
  }

  /**
   * 切换房间绑定的词库包列表（支持同时选择多个词库）。
   */
  selectPackages(
    playerId: string,
    packageIds: string[],
    expectedVersion?: number,
  ): VocabularySnapshot {
    const room = this.context.getHostRoom(playerId)
    if (room.phase !== 'waiting') {
      throw new AppError({
        message: serverStrings.errors.SETTINGS_LOCKED_VOCABULARY,
        code: ERROR_CODES.SETTINGS_LOCKED,
        status: 409,
      })
    }

    if (expectedVersion !== undefined && room.stateVersion !== expectedVersion) {
      throw new ConflictError(
        serverStrings.errors.VERSION_CONFLICT_VOCABULARY,
        ERROR_CODES.VERSION_CONFLICT,
      )
    }

    if (!packageIds.length) {
      throw new AppError({
        message: serverStrings.errors.VOCABULARY_PACKAGE_NOT_FOUND,
        code: ERROR_CODES.NOT_FOUND,
        status: 422,
      })
    }

    for (const id of packageIds) {
      if (!this.context.registry.get(id)) {
        throw new NotFoundError(
          serverStrings.errors.VOCABULARY_PACKAGE_NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        )
      }
    }

    const target = this.context.registry.getCombined(packageIds)
    if (target.items.length < MIN_SELECTED_VOCABULARY_WORDS) {
      throw new AppError({
        message: serverStrings.errors.VOCABULARY_PACKAGE_TOO_SMALL(
          target.items.length,
          MIN_SELECTED_VOCABULARY_WORDS,
        ),
        code: ERROR_CODES.VOCABULARY_TOO_SMALL,
        status: 422,
      })
    }

    room.vocabularyPackageIds = [...packageIds]
    room.vocabularyPackageId = packageIds[0]
    room.selectedWordIds = new Set(target.items.map((word) => word.id))
    room.stateVersion += 1

    this.context.addNotice(
      room,
      serverStrings.notices.vocabularyPackageSwitched(target.meta.name || packageIds.join('、')),
    )
    this.context.emitRoom(room.id)

    return this.get(playerId)
  }

  /**
   * 切换房间绑定的词库包（兼容单 ID 或多 ID 入参）。
   */
  selectPackage(
    playerId: string,
    packageIdOrIds: string | string[],
    expectedVersion?: number,
  ): VocabularySnapshot {
    const packageIds = Array.isArray(packageIdOrIds) ? packageIdOrIds : [packageIdOrIds]
    return this.selectPackages(playerId, packageIds, expectedVersion)
  }

  /**
   * 勾选或排除指定词条。
   */
  update(playerId: string, ids: string[], expectedVersion: number): VocabularySnapshot {
    const room = this.context.getHostRoom(playerId)
    if (room.phase !== 'waiting') {
      throw new AppError({
        message: serverStrings.errors.SETTINGS_LOCKED_VOCABULARY,
        code: ERROR_CODES.SETTINGS_LOCKED,
        status: 409,
      })
    }

    if (room.stateVersion !== expectedVersion) {
      throw new ConflictError(
        serverStrings.errors.VERSION_CONFLICT_VOCABULARY,
        ERROR_CODES.VERSION_CONFLICT,
      )
    }

    const store = this.context.getStore(room)
    const selected = new Set(ids)
    if (selected.size < MIN_SELECTED_VOCABULARY_WORDS) {
      throw new AppError({
        message: serverStrings.errors.VOCABULARY_TOO_SMALL(MIN_SELECTED_VOCABULARY_WORDS),
        code: ERROR_CODES.VOCABULARY_TOO_SMALL,
        status: 422,
      })
    }

    for (const id of selected) {
      if (!store.byId.has(id)) {
        throw new AppError({
          message: serverStrings.errors.INVALID_WORD_ID,
          code: ERROR_CODES.INVALID_WORD_ID,
          status: 422,
        })
      }
    }

    room.selectedWordIds = selected
    room.stateVersion += 1

    this.context.addNotice(room, serverStrings.notices.vocabularyUpdated)
    this.context.emitRoom(room.id)

    return this.get(playerId)
  }
}
