import { computed, ref, type Ref } from 'vue'
import type { VocabularyPackageInfo } from '@draw-guess/shared'
import { applySortDir, compareValues, useTableSort } from './useTableSort'

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
    // 边界适配断言：sortKey 是表头列定义传入的自由字符串（列 key 即模型属性名的
    // 登记约定），编译器无法证明 string ⊆ keyof VocabularyPackageInfo，这里按约定收窄。
    const key = sort.sortKey.value as keyof VocabularyPackageInfo
    const sorted = [...options.packages.value].sort((left, right) =>
      compareValues(left[key], right[key]),
    )
    return applySortDir(sorted, sort.sortDir.value === 'desc')
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
