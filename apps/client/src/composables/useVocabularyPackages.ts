import { computed, ref, type Ref } from 'vue'
import type { VocabularyPackageInfo } from '@draw-guess/shared'
import { useTableSort } from './useTableSort'

/** 词库包的排序、pending 单选与异步切换状态。 */
export function useVocabularyPackages(options: {
  packages: Ref<VocabularyPackageInfo[]>
  activePackageId: Ref<string>
  isReadOnly: () => boolean
  select: (packageId: string) => Promise<boolean>
  onSelected: () => void | Promise<void>
}) {
  const pendingPackageId = ref<string>()
  const sort = useTableSort()
  const displayedPackageId = computed(() => pendingPackageId.value ?? options.activePackageId.value)
  const rows = computed(() => {
    if (!sort.sortKey.value) return options.packages.value
    const key = sort.sortKey.value as keyof VocabularyPackageInfo
    const sorted = [...options.packages.value].sort((left, right) => {
      const leftValue = left[key]
      const rightValue = right[key]
      if (typeof leftValue === 'number' && typeof rightValue === 'number')
        return leftValue - rightValue
      return String(leftValue ?? '').localeCompare(String(rightValue ?? ''), 'zh-Hans-CN')
    })
    return sort.sortDir.value === 'desc' ? sorted.reverse() : sorted
  })

  async function select(packageId: string): Promise<void> {
    if (
      options.isReadOnly() ||
      pendingPackageId.value ||
      packageId === options.activePackageId.value
    )
      return
    pendingPackageId.value = packageId
    try {
      if (await options.select(packageId)) await options.onSelected()
    } finally {
      pendingPackageId.value = undefined
    }
  }

  return {
    pendingPackageId,
    displayedPackageId,
    rows,
    sortKey: sort.sortKey,
    sortDir: sort.sortDir,
    handleSort: sort.handleSort,
    select,
    resetPending: () => (pendingPackageId.value = undefined),
  }
}
