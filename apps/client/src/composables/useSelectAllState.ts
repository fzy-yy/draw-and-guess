/**
 * 「统一三态复选框」状态组合式函数：给定展示行与已选集合，推导 all/some/none 三态。
 * 现存唯一消费者是词库表格视图（VocabTableView 表头）；历史曾含散列视图（统计栏），
 * 该视图已下线，抽出本组合式的动机（避免两处判定顺序漂移）保留供回潮时复用。
 */
import { computed, type ComputedRef, type Ref } from 'vue'

type SelectAllState = 'all' | 'some' | 'none'

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
