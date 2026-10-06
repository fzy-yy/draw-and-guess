import { computed, ref, type Ref } from 'vue'
import type { VocabularyPackageInfo } from '@draw-guess/shared'
import { applySortDir, compareValues, useTableSort } from './useTableSort'

/** 词库包的排序、pending 多选与异步切换状态。 */
export function useVocabularyPackages(options: {
  packages: Ref<VocabularyPackageInfo[]>
  activePackageIds?: Ref<string[]>
  activePackageId?: Ref<string>
  isReadOnly: () => boolean
  select: (packageIds: string[]) => Promise<boolean>
  onSelected: () => void | Promise<void>
}) {
  const pendingPackageIds = ref<string[]>()
  const sort = useTableSort()
  const currentActiveIds = computed<string[]>(() => {
    if (options.activePackageIds?.value) return options.activePackageIds.value
    if (options.activePackageId?.value) return [options.activePackageId.value]
    return []
  })
  const displayedPackageIds = computed<Set<string>>(() => {
    return new Set(pendingPackageIds.value ?? currentActiveIds.value)
  })
  const displayedPackageId = computed(() => {
    const first = Array.from(displayedPackageIds.value)[0]
    return first ?? ''
  })
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

  async function select(packageIds: string[] | string): Promise<void> {
    const ids = Array.isArray(packageIds) ? packageIds : [packageIds]
    if (options.isReadOnly() || pendingPackageIds.value || ids.length === 0) return
    pendingPackageIds.value = ids
    try {
      if (await options.select(ids)) await options.onSelected()
    } finally {
      pendingPackageIds.value = undefined
    }
  }

  async function toggle(packageId: string): Promise<void> {
    if (options.isReadOnly() || pendingPackageIds.value) return
    const current = currentActiveIds.value
    let next: string[]
    if (current.includes(packageId)) {
      // 如果已选中，至少保留一个词库包
      if (current.length <= 1) return
      next = current.filter((id) => id !== packageId)
    } else {
      next = [...current, packageId]
    }
    await select(next)
  }
  return {
    pendingPackageId: computed(() => pendingPackageIds.value?.[0]),
    pendingPackageIds,
    displayedPackageId,
    displayedPackageIds,
    rows,
    sortKey: sort.sortKey,
    sortDir: sort.sortDir,
    handleSort: sort.handleSort,
    select,
    toggle,
    resetPending: () => (pendingPackageIds.value = undefined),
  }
}
