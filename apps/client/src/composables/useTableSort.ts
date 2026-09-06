import { ref } from 'vue'

/** DataTable 的受控排序状态，词条表与词库包表复用同一切换语义。 */
export function useTableSort() {
  const sortKey = ref<string | null>(null)
  const sortDir = ref<'asc' | 'desc'>('asc')

  function handleSort(key: string): void {
    if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    else {
      sortKey.value = key
      sortDir.value = 'asc'
    }
  }

  return { sortKey, sortDir, handleSort }
}
