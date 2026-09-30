<!--
  通用数据表格组件（可复用，泛型化）。
  职责边界（保持「纯展示」，业务状态全部由调用方持有，保证组件可嵌入任意场景）：
  - 列由调用方以 columns 定义（key/label/排序开关/排序取值/宽度权重），渲染哪些列完全由调用方传入的数组决定；
  - 表头点击上抛 sort 事件（升/降序切换由父组件维护 sortKey/sortDir 后回传）；
  - 单元格支持两种渲染方式：具名插槽 `cell-<key>`（自定义富内容）或缺省的文本渲染；
  - 可选行首选择列：传入 selectedIds 后显示；multiple 模式使用三态复选框，single 模式使用单选按钮；
    选择状态始终由父组件持有，点击上抛 toggle/toggle-all 事件，由父组件裁决；
  - 表体经 useVirtualTableRows（内含 useVirtualRows）虚拟滚动：数千行词条只挂载可视行，避免一次性渲染卡顿；
  - 空态文案、行悬停高亮、斑马纹等视觉细节内置，与游戏舞台主题协调。
  典型用法见 components/room/VocabTableView.vue（词库管理表格视图）。
-->
<script setup lang="ts" generic="T extends object">
import { computed, ref, useId } from 'vue'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import { useVirtualTableRows } from '@/composables/useVirtualTableRows'
import type { DataTableColumn } from './data-table.types'
import { DATA_TABLE_SELECTION_COLUMN_WIDTH, getColumnWidths } from './data-table-layout'
import DataTableHeader from './DataTableHeader.vue'

const props = defineProps<{
  /** 列定义（可见列完全由调用方传入的数组决定，本组件不感知过滤逻辑） */
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
  /** 行首选择控件类型；缺省为支持批量选择的复选框。 */
  selectionMode?: 'multiple' | 'single'
  /** 禁用全部行首选择控件；用于只读场景仍展示当前选择。 */
  selectionDisabled?: boolean
  /** 表头统一复选框的三态：'all' 全选 / 'some' 部分选中（半选样式）/ 'none' 未选 */
  selectAllState?: 'all' | 'some' | 'none'
  /** 表头统一复选框的无障碍标签（语义由调用方注入，组件不感知业务命名空间） */
  selectAllAria: string
  /** 空态标题文案（语义由调用方注入，组件不感知业务命名空间） */
  emptyText: string
  /** 行首复选框的无障碍标签取值（默认取行唯一键的字符串化；建议传入更可读的字段） */
  rowAria?: (row: T) => string
}>()

// 注意：泛型组件不用 withDefaults —— 它会破坏 vue-tsc 对 T 的推断（回落到约束类型），
// 缺省值改在模板/计算中用 ?? 兜底。
const activeSortKey = computed(() => props.sortKey ?? null)
const activeSortDir = computed(() => props.sortDir ?? 'asc')
const activeSelectionMode = computed(() => props.selectionMode ?? 'multiple')
/** 同一 DataTable 的单选按钮共享原生 name，获得正确的键盘单选组行为；不同表格间保持隔离。 */
const selectionGroupName = `data-table-selection-${useId()}`

const emit = defineEmits<{
  /** 点击表头：上抛列 key，升/降序切换逻辑由父组件裁决 */
  sort: [key: string]
  /** 行首复选列勾选变化：上抛该行唯一键 */
  toggle: [id: string]
  /** 表头统一复选框点击：批量全选/取消的范围由父组件裁决 */
  'toggle-all': []
}>()

function sort(key: string): void {
  playInteractionSound('select')
  emit('sort', key)
}

function toggle(id: string): void {
  playInteractionSound('select')
  emit('toggle', id)
}

function toggleAll(): void {
  playInteractionSound('select')
  emit('toggle-all')
}

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

const scrollContainer = ref<HTMLElement>()
const {
  virtualizer: rowVirtualizer,
  topSpacerHeight,
  bottomSpacerHeight,
  rowAt,
  scrollToTop,
} = useVirtualTableRows<T>(
  computed<T[]>(() => props.rows),
  scrollContainer,
)

defineExpose({ scrollToTop })

/**
 * 可见列的内联宽度（百分比）：按权重相对占比归一化到 100%，
 * 配合 table-fixed 保证列宽稳定且始终从左到右铺满整表。
 */
const columnWidths = computed(() => {
  return getColumnWidths(props.columns, Boolean(props.selectedIds))
})

/**
 * 可视行：把虚拟滚动项映射为「已收窄到 T」的行（越界 undefined 直接过滤掉）。
 * 模板若逐个调用 rowAt(index) 再判空，Vue 模板无法对函数返回值做类型收窄，
 * 会逼出大量 `rowAt(...)!` 非空断言；在此集中收窄一次，模板消费 item.row 即无断言。
 */
const visibleRows = computed(() =>
  rowVirtualizer.value.getVirtualItems().flatMap((virtualRow) => {
    const row = rowAt(virtualRow.index)
    return row ? [{ key: virtualRow.key, row }] : []
  }),
)
</script>

<template>
  <div
    class="flex min-h-0 flex-col overflow-hidden rounded-none border-[0.16cqh] border-line bg-white"
  >
    <!-- 表格区：表头吸顶，表体滚动（容器高度由调用方控制）；内部只挂载可视行。
         顶部/底部虚拟占位是 tbody 内的 tr/td（colspan）：列宽已由 colgroup 逐列定死，
         占位行不再参与「第一行决定列宽」的读取（旧注释担心的错位空白随 colgroup 方案不存在了）。
         占位高度也不能挂到 th 上——thead 仅此一行且 sticky 吸顶，把 th 撑到占位高会让
         表头本身占满滚动区、吞掉可视行；占位必须留在 tbody 内随内容滚动。 -->
    <div
      ref="scrollContainer"
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-stable"
    >
      <table class="w-full table-fixed border-collapse text-left text-fs-12 text-navy">
        <colgroup>
          <col v-if="props.selectedIds" :style="{ width: DATA_TABLE_SELECTION_COLUMN_WIDTH }" />
          <col
            v-for="column in props.columns"
            :key="column.key"
            :style="{ width: columnWidths.get(column.key) }"
          />
        </colgroup>
        <DataTableHeader
          :columns="props.columns"
          :widths="columnWidths"
          :has-selection="Boolean(props.selectedIds)"
          :selection-mode="activeSelectionMode"
          :selection-disabled="props.selectionDisabled"
          :select-all-state="props.selectAllState"
          :select-all-aria="selectAllAria"
          :sort-key="activeSortKey"
          :sort-dir="activeSortDir"
          @sort="sort"
          @toggle-all="toggleAll"
        />
        <tbody>
          <!-- 顶部占位行：置于 tbody 内配合 colgroup，不推挤 thead，根除滚动跳动 -->
          <tr
            v-if="topSpacerHeight > 0"
            aria-hidden="true"
            :style="{ height: `${topSpacerHeight}px` }"
          >
            <td
              :colspan="props.columns.length + (props.selectedIds ? 1 : 0)"
              class="p-0 border-0 pointer-events-none"
            ></td>
          </tr>
          <tr
            v-for="item in visibleRows"
            :key="String(item.key)"
            class="border-t-[0.12cqh] border-t-line ui-feedback hover:bg-sky"
            :class="isSelected(item.row) ? 'bg-sky' : 'bg-white'"
          >
            <!-- 行首选择列：多选用于词条批量管理，单选用于互斥的词库包选择。 -->
            <td v-if="props.selectedIds" class="px-[0.5em] py-[0.4cqh]">
              <input
                :type="activeSelectionMode === 'single' ? 'radio' : 'checkbox'"
                :name="activeSelectionMode === 'single' ? selectionGroupName : undefined"
                class="h-[max(1.6cqh,16px)] w-[max(1.6cqh,16px)] accent-blue disabled:cursor-not-allowed disabled:opacity-60"
                :class="{ 'rounded-none': activeSelectionMode === 'multiple' }"
                :disabled="props.selectionDisabled"
                :checked="isSelected(item.row)"
                :aria-label="
                  props.rowAria ? props.rowAria(item.row) : String(item.row[props.rowKey])
                "
                @change="toggle(String(item.row[props.rowKey]))"
              />
            </td>
            <td
              v-for="column in props.columns"
              :key="column.key"
              class="min-w-0 px-[0.6em] py-[0.4cqh] align-middle"
            >
              <!-- 富内容插槽：调用方可为任意列提供自定义渲染（如难度星级、分类徽章） -->
              <slot :name="`cell-${column.key}`" :row="item.row" :value="item.row[column.key]">
                <span class="block truncate" :title="displayValue(item.row, column)">{{
                  displayValue(item.row, column)
                }}</span>
              </slot>
            </td>
          </tr>
          <!-- 底部占位行 -->
          <tr
            v-if="bottomSpacerHeight > 0"
            aria-hidden="true"
            :style="{ height: `${bottomSpacerHeight}px` }"
          >
            <td
              :colspan="props.columns.length + (props.selectedIds ? 1 : 0)"
              class="p-0 border-0 pointer-events-none"
            ></td>
          </tr>
        </tbody>
      </table>
      <!-- 空态：无数据或筛选无结果 -->
      <div
        v-if="!props.rows.length"
        class="flex flex-col items-center gap-[0.4cqh] px-[1em] py-[3cqh] text-center text-fs-12 text-muted"
      >
        <b>{{ emptyText }}</b>
      </div>
    </div>
  </div>
</template>
