import type { DataTableColumn } from './data-table.types'

/** 统一计算数据列宽，显式扣除固定选择列，避免 table-fixed 隐式压缩业务列。 */
export function getColumnWidths<T extends object>(
  columns: DataTableColumn<T>[],
  hasSelection: boolean,
): Map<string, string> {
  const total = columns.reduce((sum, column) => sum + (column.weight ?? 1), 0)
  const map = new Map<string, string>()
  for (const column of columns) {
    const ratio = (((column.weight ?? 1) / total) * 100).toFixed(3)
    map.set(column.key, hasSelection ? `calc((100% - 3.2em) * ${ratio} / 100)` : `${ratio}%`)
  }
  return map
}
