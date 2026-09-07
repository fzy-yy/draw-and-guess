import { ref } from 'vue'
import type { VocabularyWord } from '@draw-guess/shared'

/** 词库 Set 选择状态；保持单项和批量操作为 O(1)/O(n)。 */
export function useVocabularySelection(isReadOnly: () => boolean) {
  const selectedIds = ref(new Set<string>())

  function reset(ids: readonly string[]): void {
    selectedIds.value = new Set(ids)
  }

  function toggle(id: string): void {
    if (isReadOnly()) return
    if (selectedIds.value.has(id)) selectedIds.value.delete(id)
    else selectedIds.value.add(id)
  }

  function setSelection(ids: readonly string[], selected: boolean): void {
    if (isReadOnly()) return
    for (const id of ids) {
      if (selected) selectedIds.value.add(id)
      else selectedIds.value.delete(id)
    }
  }

  function toggleAll(words: readonly VocabularyWord[]): void {
    if (isReadOnly()) return
    const select = !words.every((word) => selectedIds.value.has(word.id))
    setSelection(
      words.map((word) => word.id),
      select,
    )
  }

  return { selectedIds, reset, toggle, setSelection, toggleAll }
}
