/**
 * 「统一三态复选框」状态组合式函数：给定展示行与已选集合，推导 all/some/none 三态。
 * 词库管理的散列视图（统计栏）与表格视图（表头）共用同一判定逻辑，
 * 避免两处各自维护一份容易漂移的 computed（历史上曾出现判定顺序不一致）。
 */
import { computed, type ComputedRef, type Ref } from 'vue'

export type SelectAllState = 'all' | 'some' | 'none'

export function useSelectAllState(
  /** 当前展示范围内的行（已应用搜索/筛选/排序）。 */
  rows: Ref<readonly { id: string }[]>,
  /** 已选 ID 集合（受控）。 */
  selectedIds: Ref<ReadonlySet<string>>,
): ComputedRef<SelectAllState> {
  return computed<SelectAllState>(() => {
    const list = rows.value
    if (!list.length || !selectedIds.value.size) return 'none'
    const selectedInRows = list.filter((row) => selectedIds.value.has(row.id)).length
    if (selectedInRows === 0) return 'none'
    return selectedInRows === list.length ? 'all' : 'some'
  })
}
