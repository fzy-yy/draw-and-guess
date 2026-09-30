/**
  词库快照与编辑 Store。
  供房主在房间等待阶段拉取词库分类并保存定制词库。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { EVENTS, type VocabularySnapshot } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'
import type { RequestResult } from './request.ts'
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

  /**
   * 词库提交骨架：saveVocabulary 与 selectVocabularyPackage 的同形五段
   * （begin→request→`!ok || !accepts`→写回→notify→true）。两者仅有的差异——
   * 请求事件/载荷、守卫绑定的包 ID、成功文案——由调用方以 send 闭包与参数传入，
   * 保证流程（含 expectedVersion 的读取时机与幂等序号推进）只有一份实现。
   */
  async function commitVocabulary(
    send: () => Promise<RequestResult<VocabularySnapshot>>,
    guardPackageId: string | undefined,
    successText: string,
  ): Promise<boolean> {
    // 无房间时 begin 返回 undefined（context 缺 roomId），与原先显式的房空检查同义，
    // 因此房存在性守卫收敛在骨架一处即可。
    const context = requestGuard.begin(state(), guardPackageId)
    if (!context) return false
    const snapshot = await send()
    if (!snapshot.ok || !requestGuard.accepts(context, state(), snapshot.data.packageId))
      return false
    vocabulary.value = snapshot.data
    notify(successText)
    return true
  }

  async function saveVocabulary(ids: string[]): Promise<boolean> {
    const room = roomStore.room
    if (!room) return false
    return commitVocabulary(
      () => request(EVENTS.roomUpdateVocabulary, { ids, expectedVersion: room.stateVersion }),
      room.vocabularyPackageId,
      strings.store.vocabularyUpdated,
    )
  }

  async function selectVocabularyPackage(packageId: string): Promise<boolean> {
    const room = roomStore.room
    if (!room) return false
    return commitVocabulary(
      () =>
        request(EVENTS.roomSelectVocabularyPackage, {
          packageId,
          expectedVersion: room.stateVersion,
        }),
      packageId,
      strings.room.vocabPackageSwitched,
    )
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
