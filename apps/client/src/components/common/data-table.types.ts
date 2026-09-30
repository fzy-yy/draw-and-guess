export interface DataTableColumn<T> {
  key: Extract<keyof T, string>
  label: string
  /** 是否可排序。注意语义是「反向开关」：缺省（undefined）即可排序，显式传 false 才禁用；
   *  DataTableHeader.vue 的 `sortable !== false` 判定即依据本约定，勿改成真值判断。 */
  sortable?: boolean
  sortValue?: (row: T) => string | number
  weight?: number
}

/**
 * 表头实际消费的最小列切面：由 DataTableColumn Pick 派生（单一权威源）。
 * 曾经 DataTableHeader.vue 手抄一份同形 interface，字段演进时会静默漂移，故收敛到本派生类型。
 */
export type DataTableHeaderColumn<T extends object> = Pick<
  DataTableColumn<T>,
  'key' | 'label' | 'sortable'
>

/** 数据表格经 defineExpose 暴露的滚动接口（当前仅滚动归零；父组件经 ref 驱动）。 */
export interface ScrollableTable {
  scrollToTop(): void
}
