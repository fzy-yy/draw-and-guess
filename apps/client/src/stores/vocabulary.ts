/**
  词库快照与编辑 Store。
  供房主在房间等待阶段拉取词库分类并保存定制词库。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { EVENTS, type VocabularySnapshot } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'
import { useRoomStore } from './room.ts'
import { useSessionStore } from './session.ts'
import { VocabularyRequestGuard } from './vocabulary-request-context.ts'

export const useVocabularyStore = defineStore('vocabulary', () => {
  const { request, notify } = useGameTransport()
  const roomStore = useRoomStore()
  const sessionStore = useSessionStore()
  const vocabulary = ref<VocabularySnapshot>()
  const requestGuard = new VocabularyRequestGuard()

  function state() {
    return { sessionGeneration: sessionStore.generation, roomId: roomStore.room?.id }
  }

  function clear(): void {
    requestGuard.invalidate()
    vocabulary.value = undefined
  }

  /** 弹窗关闭时废弃尚未返回的 UI 操作；服务端幂等请求可继续完成但不能写回旧界面。 */
  function cancelPending(): void {
    requestGuard.invalidate()
  }

  async function loadVocabulary(): Promise<void> {
    const context = requestGuard.begin(state(), roomStore.room?.vocabularyPackageId)
    if (!context) return
    const snapshot = await request(EVENTS.roomGetVocabulary)
    if (snapshot.ok && requestGuard.accepts(context, state(), snapshot.data.packageId))
      vocabulary.value = snapshot.data
  }

  async function saveVocabulary(ids: string[]): Promise<boolean> {
    if (!roomStore.room) return false
    const context = requestGuard.begin(state(), roomStore.room.vocabularyPackageId)
    if (!context) return false
    const snapshot = await request(EVENTS.roomUpdateVocabulary, {
      ids,
      expectedVersion: roomStore.room.stateVersion,
    })
    if (!snapshot.ok || !requestGuard.accepts(context, state(), snapshot.data.packageId))
      return false
    vocabulary.value = snapshot.data
    notify(strings.store.vocabularyUpdated)
    return true
  }

  async function selectVocabularyPackage(packageId: string): Promise<boolean> {
    if (!roomStore.room) return false
    const context = requestGuard.begin(state(), packageId)
    if (!context) return false
    const snapshot = await request(EVENTS.roomSelectVocabularyPackage, {
      packageId,
      expectedVersion: roomStore.room.stateVersion,
    })
    if (!snapshot.ok || !requestGuard.accepts(context, state(), snapshot.data.packageId))
      return false
    vocabulary.value = snapshot.data
    notify(strings.room.vocabPackageSwitched)
    return true
  }

  return {
    vocabulary,
    clear,
    cancelPending,
    loadVocabulary,
    saveVocabulary,
    selectVocabularyPackage,
  }
})
