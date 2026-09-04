<!--
  通用数据表格组件（可复用，泛型化）。
  职责边界（保持「纯展示」，业务状态全部由调用方持有，保证组件可嵌入任意场景）：
  - 列由调用方以 columns 定义（key/label/排序取值/对齐/宽度），并预先完成「列显隐」过滤；
  - 表头点击上抛 sort 事件（升/降序切换由父组件维护 sortKey/sortDir 后回传）；
  - 单元格支持两种渲染方式：具名插槽 `cell-<key>`（自定义富内容）或缺省的文本渲染；
  - 可选行首复选列：传入 selectedIds 后显示；表头复选框为三态统一全选
    （全选/部分选中/未选），点击上抛 toggle-all 事件，由父组件裁决批量选择范围；
  - 表体经 useVirtualRows 虚拟滚动：数千行词条只挂载可视行，避免一次性渲染卡顿；
  - 空态文案、行悬停高亮、斑马纹等视觉细节内置，与游戏舞台主题协调。
  典型用法见 components/room/VocabTableView.vue（词库管理表格视图）。
-->
<script setup lang="ts" generic="T extends object">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useVirtualRows } from '@/composables/useVirtualRows'

/** 列定义：key 限定为行对象的字段名；排序取值可用 sortValue 自定义（如数组 join、缺省回退） */
export interface DataTableColumn<T> {
  key: Extract<keyof T, string>
  label: string
  /** 是否可点击表头排序；缺省 true */
  sortable?: boolean
  /** 排序取值函数；缺省直接取 row[key]（须为 string | number） */
  sortValue?: (row: T) => string | number
  /** 单元格内容对齐；缺省 left */
  align?: 'left' | 'center' | 'right'
  /**
   * 列宽相对权重（如 22）；所有可见列按权重占比瓜分表格宽度。
   * 不用固定百分比：列显隐后剩余列自动重新铺满整表，内容始终从左侧开始，
   * 不会出现「隐藏字段后内容贴向右边、左侧留大片空白」的错位。
   */
  weight?: number
}

const props = defineProps<{
  /** 列定义（调用方已按「显示字段」过滤后的可见列） */
  columns: DataTableColumn<T>[]
  /** 行数据（已由调用方完成搜索/筛选/排序） */
  rows: T[]
  /** 行唯一键字段名 */
  rowKey: keyof T & string
  /** 当前排序字段（null/undefined = 未排序，保持数据原序） */
  sortKey?: string | null
  /** 当前排序方向；缺省 asc */
  sortDir?: 'asc' | 'desc'
  /** 可选：行首复选列的选中集合；不传则不渲染复选列 */
  selectedIds?: Set<string>
  /** 表头统一复选框的三态：'all' 全选 / 'some' 部分选中（半选样式）/ 'none' 未选 */
  selectAllState?: 'all' | 'some' | 'none'
  /** 表头统一复选框的无障碍标签（语义由调用方注入，组件不感知业务命名空间） */
  selectAllAria: string
  /** 空态标题文案（语义由调用方注入，组件不感知业务命名空间） */
  emptyText: string
  /** 空态补充说明（如「可在显示字段中开启更多列」） */
  emptyHint?: string
  /** 行首复选框的无障碍标签取值（默认取行唯一键的字符串化；建议传入更可读的字段） */
  rowAria?: (row: T) => string
}>()

// 注意：泛型组件不用 withDefaults —— 它会破坏 vue-tsc 对 T 的推断（回落到约束类型），
// 缺省值改在模板/计算中用 ?? 兜底。
const activeSortKey = computed(() => props.sortKey ?? null)
const activeSortDir = computed(() => props.sortDir ?? 'asc')

const emit = defineEmits<{
  /** 点击表头：上抛列 key，升/降序切换逻辑由父组件裁决 */
  sort: [key: string]
  /** 行首复选列勾选变化：上抛该行唯一键 */
  toggle: [id: string]
  /** 表头统一复选框点击：批量全选/取消的范围由父组件裁决 */
  'toggle-all': []
}>()

/** 判断某行是否处于选中态（行首复选列） */
function isSelected(row: T): boolean {
  return props.selectedIds?.has(String(row[props.rowKey])) ?? false
}

/** 单元格缺省渲染：数组 join、其余 String 化；富内容请用具名插槽 cell-<key> 覆盖。 */
function displayValue(row: T, column: DataTableColumn<T>): string {
  const value = row[column.key]
  if (Array.isArray(value))
    return value.length ? value.join(strings.common.listSeparator) : strings.common.emptyDash
  if (value === undefined || value === null || value === '') return strings.common.emptyDash
  return String(value)
}

// —— 表体虚拟滚动：行高先按 38px 估算，再由 measureElement 实测校准 ——
const scrollContainer = ref<HTMLElement>()
const { virtualizer: rowVirtualizer, measureElementRef } = useVirtualRows({
  scrollElement: scrollContainer,
  count: computed(() => props.rows.length),
  estimateSize: 38,
})
/** 取虚拟行索引对应的原始行数据（itemsPerVirtual=1，切片即单行）。 */
function rowAt(index: number): T | undefined {
  return props.rows[index]
}

/**
 * 可见列的内联宽度（百分比）：按权重相对占比归一化到 100%，
 * 配合 table-fixed 保证列宽稳定且始终从左到右铺满整表。
 */
const columnWidths = computed(() => {
  const total = props.columns.reduce((sum, column) => sum + (column.weight ?? 1), 0)
  const map = new Map<string, string>()
  for (const column of props.columns) {
    map.set(column.key, `${(((column.weight ?? 1) / total) * 100).toFixed(3)}%`)
  }
  return map
})
/** 取顶部/底部虚拟占位高度（把可视行推到滚动条对应偏移；占位行放在 table 外，见模板）。 */
const topSpacerHeight = computed(() =>
  rowVirtualizer.value.getVirtualItems().length
    ? rowVirtualizer.value.getVirtualItems()[0]!.start
    : 0,
)
const bottomSpacerHeight = computed(() => {
  const items = rowVirtualizer.value.getVirtualItems()
  if (!items.length) return 0
  const last = items.at(-1)!
  return rowVirtualizer.value.getTotalSize() - (last.start + last.size)
})
</script>

<template>
  <div
    class="flex min-h-0 flex-col overflow-hidden rounded-[0.7em] border-[0.16cqh] border-line bg-white"
  >
    <!-- 表格区：表头吸顶，表体滚动（容器高度由调用方控制）；内部只挂载可视行。
         顶部/底部虚拟占位用 table 外的 div 承载：table-fixed 的列宽由「表格第一行」决定，
         若占位 tr/td（colspan）成为第一行，列宽将无法从 th 读取，会产生错位空白。 -->
    <div
      ref="scrollContainer"
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-stable"
    >
      <div aria-hidden="true" :style="{ height: `${topSpacerHeight}px` }"></div>
      <table class="w-full table-fixed border-collapse text-left text-[0.72em] text-navy">
        <thead class="sticky top-0 z-10 bg-line shadow-[0_0.2cqh_0_var(--color-line)]">
          <tr>
            <!-- 可选行首复选列表头：三态统一复选框（全选当前结果 / 取消全选），范围由父组件裁决 -->
            <th v-if="props.selectedIds" class="w-[3.2em] px-[0.5em] py-[0.55cqh]">
              <input
                type="checkbox"
                class="h-[1.6cqh] w-[1.6cqh] accent-blue"
                :checked="props.selectAllState === 'all'"
                :indeterminate="props.selectAllState === 'some'"
                :aria-label="selectAllAria"
                @change="emit('toggle-all')"
              />
            </th>
            <th
              v-for="column in props.columns"
              :key="column.key"
              class="whitespace-nowrap px-[0.6em] py-[0.55cqh] font-black text-muted"
              :style="{ width: columnWidths.get(column.key) }"
              :class="[
                column.align === 'center'
                  ? 'text-center'
                  : column.align === 'right'
                    ? 'text-right'
                    : '',
              ]"
              :aria-sort="
                activeSortKey === column.key
                  ? activeSortDir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              "
            >
              <!-- 可排序列：按钮化表头 + 双向箭头指示当前排序方向 -->
              <button
                v-if="column.sortable !== false"
                type="button"
                class="inline-flex items-center gap-[0.25em] rounded-[0.3em] px-[0.25em] py-[0.1cqh] hover:bg-line"
                :aria-label="strings.common.sortByAria(column.label)"
                @click="emit('sort', column.key)"
              >
                {{ column.label }}
                <ArrowUp
                  v-if="activeSortKey === column.key && activeSortDir === 'asc'"
                  class="h-[1.2cqh] w-[1.2cqh] text-blue"
                  aria-hidden="true"
                />
                <ArrowDown
                  v-else-if="activeSortKey === column.key && activeSortDir === 'desc'"
                  class="h-[1.2cqh] w-[1.2cqh] text-blue"
                  aria-hidden="true"
                />
                <ArrowUpDown v-else class="h-[1.2cqh] w-[1.2cqh] text-muted" aria-hidden="true" />
              </button>
              <span v-else>{{ column.label }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- 顶部占位行已移至 table 外（见滚动容器注释），此处只保留可视行 -->
          <tr
            v-for="virtualRow in rowVirtualizer.getVirtualItems()"
            :key="String(virtualRow.key)"
            :ref="measureElementRef"
            :data-index="virtualRow.index"
            class="border-t-[0.12cqh] border-t-line ui-feedback hover:bg-sky"
            :class="
              rowAt(virtualRow.index) && isSelected(rowAt(virtualRow.index)!) ? 'bg-sky!' : ''
            "
          >
            <!-- 行首复选列：词库选择与表格浏览共存，勾选即写入父组件的已选集合 -->
            <td v-if="props.selectedIds" class="px-[0.5em] py-[0.4cqh]">
              <input
                type="checkbox"
                class="h-[1.6cqh] w-[1.6cqh] accent-blue"
                :checked="rowAt(virtualRow.index) ? isSelected(rowAt(virtualRow.index)!) : false"
                :aria-label="
                  rowAt(virtualRow.index)
                    ? props.rowAria
                      ? props.rowAria(rowAt(virtualRow.index)!)
                      : String(rowAt(virtualRow.index)![props.rowKey])
                    : undefined
                "
                @change="
                  rowAt(virtualRow.index) &&
                  emit('toggle', String(rowAt(virtualRow.index)![props.rowKey]))
                "
              />
            </td>
            <td
              v-for="column in props.columns"
              :key="column.key"
              class="min-w-0 px-[0.6em] py-[0.4cqh] align-middle"
              :class="
                column.align === 'center'
                  ? 'text-center'
                  : column.align === 'right'
                    ? 'text-right'
                    : ''
              "
            >
              <!-- 富内容插槽：调用方可为任意列提供自定义渲染（如难度星级、分类徽章） -->
              <slot
                v-if="rowAt(virtualRow.index)"
                :name="`cell-${column.key}`"
                :row="rowAt(virtualRow.index)!"
                :value="rowAt(virtualRow.index)![column.key]"
              >
                <span
                  class="block truncate"
                  :title="displayValue(rowAt(virtualRow.index)!, column)"
                  >{{ displayValue(rowAt(virtualRow.index)!, column) }}</span
                >
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
      <div aria-hidden="true" :style="{ height: `${bottomSpacerHeight}px` }"></div>
      <!-- 空态：无数据或筛选无结果 -->
      <div
        v-if="!props.rows.length"
        class="flex flex-col items-center gap-[0.4cqh] px-[1em] py-[3cqh] text-center text-[0.72em] text-muted"
      >
        <b>{{ emptyText }}</b>
        <span v-if="props.emptyHint">{{ props.emptyHint }}</span>
      </div>
    </div>
  </div>
</template>
