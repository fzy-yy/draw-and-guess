import { serverStrings } from '../../../../../string/index.ts'
import { MIN_SELECTED_VOCABULARY_WORDS, type VocabularySnapshot } from '@draw-guess/shared'
import { GameError } from '../../errors.ts'
import type { RoomSecret } from '../../models.ts'
import type { VocabularyRegistry, VocabularyStore } from '../../vocabulary/index.ts'

export interface RoomVocabularyContext {
  registry: VocabularyRegistry
  getMembership(playerId: string): { room: RoomSecret }
  getHostRoom(playerId: string): RoomSecret
  getStore(room: RoomSecret): VocabularyStore
  addNotice(room: RoomSecret, text: string): void
  persist(room: RoomSecret): void
  emitRoom(roomId: string): void
}

/** 房间词库的读取、包切换与词条选择用例。 */
export class RoomVocabularyService {
  constructor(private readonly context: RoomVocabularyContext) {}

  get(playerId: string): VocabularySnapshot {
    const { room } = this.context.getMembership(playerId)
    const store = this.context.getStore(room)
    const packages = 'packages' in this.context.registry ? this.context.registry.packages : []
    const packageId =
      room.vocabularyPackageId ||
      ('defaultPackageId' in this.context.registry
        ? this.context.registry.defaultPackageId
        : store.meta.id || '')
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
    const target = 'get' in this.context.registry ? this.context.registry.get(packageId) : undefined
    if (!target) throw new GameError('NOT_FOUND', serverStrings.errors.VOCABULARY_PACKAGE_NOT_FOUND)
    room.vocabularyPackageId = packageId
    room.selectedWordIds = new Set(target.items.map((word) => word.id))
    room.stateVersion += 1
    this.context.addNotice(
      room,
      serverStrings.notices.vocabularyPackageSwitched(target.meta.name || packageId),
    )
    this.context.persist(room)
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
    this.context.persist(room)
    this.context.emitRoom(room.id)
    return this.get(playerId)
  }
}
