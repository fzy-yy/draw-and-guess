export interface DataTableColumn<T> {
  key: Extract<keyof T, string>
  label: string
  sortable?: boolean
  sortValue?: (row: T) => string | number
  weight?: number
}

/** 数据表格经 defineExpose 暴露的滚动接口（父组件经 ref 驱动滚动归零）。 */
export interface ScrollableTable {
  scrollToTop(): void
  scrollToIndex(index: number): void
}
