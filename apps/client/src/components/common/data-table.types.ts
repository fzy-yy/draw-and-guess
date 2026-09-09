export interface DataTableColumn<T> {
  key: Extract<keyof T, string>
  label: string
  sortable?: boolean
  sortValue?: (row: T) => string | number
  align?: 'left' | 'center' | 'right'
  weight?: number
}
