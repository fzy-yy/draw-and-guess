import { serverStrings } from '@draw-guess/strings'
import { MIN_SELECTED_VOCABULARY_WORDS, type VocabularySnapshot } from '@draw-guess/shared'
import { GameError } from '../../errors.ts'
import type { RoomSecret } from '../../models.ts'
import type { VocabularyRegistry, VocabularyStore } from '../../vocabulary/index.ts'
import type { RoomEventPorts } from '../shared-ports.ts'

/**
 * 房间词库用例端口：房间推送出口复用共享接口（见 domain/shared-ports.ts），
 * 其余为本用例特有成员。
 */
interface RoomVocabularyContext extends RoomEventPorts {
  registry: VocabularyRegistry
  getMembership(playerId: string): { room: RoomSecret }
  getHostRoom(playerId: string): RoomSecret
  getStore(room: RoomSecret): VocabularyStore
  addNotice(room: RoomSecret, text: string): void
}

/** 房间词库的读取、包切换与词条选择用例。 */
export class RoomVocabularyService {
  constructor(private readonly context: RoomVocabularyContext) {}

  get(playerId: string): VocabularySnapshot {
    const { room } = this.context.getMembership(playerId)
    const store = this.context.getStore(room)
    // registry 契约成员均为必选（VocabularyRegistry），直接取用，不再运行时探活。
    const packages = this.context.registry.packages
    const packageId = room.vocabularyPackageId || this.context.registry.defaultPackageId
    return {
      packageId,
      packages,
      items: store.items,
      selectedIds: [...room.selectedWordIds],
      version: store.version,
      categories: store.meta.categoryEnum,
    }
  }

  selectPackage(playerId: string, packageId: string, expectedVersion?: number): VocabularySnapshot {
    const room = this.context.getHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('SETTINGS_LOCKED', serverStrings.errors.SETTINGS_LOCKED_VOCABULARY)
    if (expectedVersion !== undefined && room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', serverStrings.errors.VERSION_CONFLICT_VOCABULARY)
    const target = this.context.registry.get(packageId)
    if (!target) throw new GameError('NOT_FOUND', serverStrings.errors.VOCABULARY_PACKAGE_NOT_FOUND)
    // 选中即校验：加载门槛（APP_CONFIG.vocabulary.minWords）只保证「库可用」，
    // 6～59 词的自定义库能出现在包列表里，却不足以开局（MIN_SELECTED_VOCABULARY_WORDS）。
    // 若放行到写入后，房主只能在开局失败时才发现并手动切回大词库；
    // 这里在任何状态写入之前以可读错误拒绝（update() 的勾选校验语义不变）。
    if (target.items.length < MIN_SELECTED_VOCABULARY_WORDS) {
      throw new GameError(
        'VOCABULARY_TOO_SMALL',
        serverStrings.errors.VOCABULARY_PACKAGE_TOO_SMALL(
          target.items.length,
          MIN_SELECTED_VOCABULARY_WORDS,
        ),
      )
    }
    room.vocabularyPackageId = packageId
    room.selectedWordIds = new Set(target.items.map((word) => word.id))
    room.stateVersion += 1
    this.context.addNotice(
      room,
      serverStrings.notices.vocabularyPackageSwitched(target.meta.name || packageId),
    )
    this.context.emitRoom(room.id)
    return this.get(playerId)
  }

  update(playerId: string, ids: string[], expectedVersion: number): VocabularySnapshot {
    const room = this.context.getHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('SETTINGS_LOCKED', serverStrings.errors.SETTINGS_LOCKED_VOCABULARY)
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', serverStrings.errors.VERSION_CONFLICT_VOCABULARY)
    const store = this.context.getStore(room)
    const selected = new Set(ids)
    if (selected.size < MIN_SELECTED_VOCABULARY_WORDS)
      throw new GameError(
        'VOCABULARY_TOO_SMALL',
        serverStrings.errors.VOCABULARY_TOO_SMALL(MIN_SELECTED_VOCABULARY_WORDS),
      )
    for (const id of selected) {
      if (!store.byId.has(id))
        throw new GameError('INVALID_WORD_ID', serverStrings.errors.INVALID_WORD_ID)
    }
    room.selectedWordIds = selected
    room.stateVersion += 1
    this.context.addNotice(room, serverStrings.notices.vocabularyUpdated)
    this.context.emitRoom(room.id)
    return this.get(playerId)
  }
}
