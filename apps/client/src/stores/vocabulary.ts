/**
  词库快照与编辑 Store。
  供房主在房间等待阶段拉取词库分类并保存定制词库。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { EVENTS, type VocabularySnapshot } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { notify } from '@/composables/useToasts'
import { socket } from './socket.ts'
import { createRequester } from './request.ts'
import { useRoomStore } from './room.ts'

export const useVocabularyStore = defineStore('vocabulary', () => {
  const roomStore = useRoomStore()
  const vocabulary = ref<VocabularySnapshot>()
  const request = createRequester({ socket, notify })

  function clear(): void {
    vocabulary.value = undefined
  }

  async function loadVocabulary(): Promise<void> {
    const snapshot = await request<VocabularySnapshot>(EVENTS.roomGetVocabulary)
    if (snapshot.ok) vocabulary.value = snapshot.data
  }

  async function saveVocabulary(ids: string[]): Promise<boolean> {
    if (!roomStore.room) return false
    const snapshot = await request<VocabularySnapshot>(EVENTS.roomUpdateVocabulary, {
      ids,
      expectedVersion: roomStore.room.stateVersion,
    })
    if (!snapshot.ok) return false
    vocabulary.value = snapshot.data
    notify(strings.store.vocabularyUpdated)
    return true
  }

  return {
    vocabulary,
    clear,
    loadVocabulary,
    saveVocabulary,
  }
})
