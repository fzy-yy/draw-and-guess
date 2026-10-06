/**
  词库快照与编辑 Store。
  供房主在房间等待阶段拉取词库分类并保存定制词库。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { EVENTS, type VocabularySnapshot } from '@draw-guess/shared'
import { useGameTransport } from '@/application/game-transport'
import type { RequestResult } from './request.ts'
import { useRoomStore } from './room.ts'
import { useSessionStore } from './session.ts'
import { VocabularyRequestGuard } from './vocabulary-request-context.ts'

export const useVocabularyStore = defineStore('vocabulary', () => {
  const { request } = useGameTransport()
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
    const context = requestGuard.begin(state(), roomStore.room?.vocabularyPackageIds)
    if (!context) return
    const snapshot = await request(EVENTS.roomGetVocabulary)
    if (snapshot.ok && requestGuard.accepts(context, state(), snapshot.data.packageIds))
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
    guardPackageIds: string[] | string | undefined,
  ): Promise<boolean> {
    const context = requestGuard.begin(state(), guardPackageIds)
    if (!context) return false
    const snapshot = await send()
    if (!snapshot.ok || !requestGuard.accepts(context, state(), snapshot.data.packageIds))
      return false
    vocabulary.value = snapshot.data
    // 词库修改或切包后，服务端会向全房间广播权威的 systemNotice，此处不重复弹本地通知（见 ADR-0053）
    return true
  }

  async function saveVocabulary(ids: string[]): Promise<boolean> {
    const room = roomStore.room
    if (!room) return false
    return commitVocabulary(
      () => request(EVENTS.roomUpdateVocabulary, { ids, expectedVersion: room.stateVersion }),
      room.vocabularyPackageIds,
    )
  }

  async function selectVocabularyPackages(packageIds: string[]): Promise<boolean> {
    const room = roomStore.room
    if (!room) return false
    return commitVocabulary(
      () =>
        request(EVENTS.roomSelectVocabularyPackage, {
          packageIds,
          expectedVersion: room.stateVersion,
        }),
      packageIds,
    )
  }

  async function selectVocabularyPackage(packageIdOrIds: string | string[]): Promise<boolean> {
    const packageIds = Array.isArray(packageIdOrIds) ? packageIdOrIds : [packageIdOrIds]
    return selectVocabularyPackages(packageIds)
  }

  return {
    vocabulary,
    clear,
    cancelPending,
    loadVocabulary,
    saveVocabulary,
    selectVocabularyPackage,
    selectVocabularyPackages,
  }
})
