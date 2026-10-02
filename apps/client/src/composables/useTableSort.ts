import { ref } from 'vue'

/**
 * 排序单元格值：两个消费点（词条列 sortValue/取值、词库包字段直读）的类型交集，
 * 均只可能产出 string 或 number（协议 schema 保证词库包字段非空且无其它类型）。
 */
type SortCellValue = string | number

/**
 * 统一升序比较：两值皆 number 时直接相减，否则按 `zh-Hans-CN` 字典序比较字符串形态。
 * 词条表与词库包表共用，保证同构排序语义单源（原两处内联实现逐字同形）。
 */
export function compareValues(left: SortCellValue, right: SortCellValue): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), 'zh-Hans-CN')
}

/**
 * 应用排序方向：desc 时整体反转升序结果（沿用原两处消费的 `sorted.reverse()` 语义，
 * 不改用「比较器取反」——两者对同值行的相对次序结论不同，reverse 会翻转并列行）。
 * 入参约定为调用方新建的排序副本，允许就地反转并返回同一数组。
 */
export function applySortDir<T>(ascending: T[], desc: boolean): T[] {
  return desc ? ascending.reverse() : ascending
}

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
