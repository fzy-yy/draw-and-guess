<!--
  通用数据表格组件（可复用，泛型化）。
  职责边界（保持「纯展示」，业务状态全部由调用方持有，保证组件可嵌入任意场景）：
  - 列由调用方以 columns 定义（key/label/排序取值/对齐/宽度），并预先完成「列显隐」过滤；
  - 表头点击上抛 sort 事件（升/降序切换由父组件维护 sortKey/sortDir 后回传）；
  - 单元格支持两种渲染方式：具名插槽 `cell-<key>`（自定义富内容）或缺省的文本渲染；
  - 可选行首选择列：传入 selectedIds 后显示；multiple 模式使用三态复选框，single 模式使用单选按钮；
    选择状态始终由父组件持有，点击上抛 toggle/toggle-all 事件，由父组件裁决；
  - 表体经 useVirtualRows 虚拟滚动：数千行词条只挂载可视行，避免一次性渲染卡顿；
  - 空态文案、行悬停高亮、斑马纹等视觉细节内置，与游戏舞台主题协调。
  典型用法见 components/room/VocabTableView.vue（词库管理表格视图）。
-->
<script setup lang="ts" generic="T extends object">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useVirtualRows } from '@/composables/useVirtualRows'
import { getColumnWidths } from './data-table-layout'

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
  /** 空态补充说明（如「可在显示字段中开启更多列」） */
  emptyHint?: string
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

// —— 表体虚拟滚动：锁定实测统一行高，避免滑动过程中因动态再测量导致 totalSize 缩放跳动 ——
const measuredRowHeight = ref(28)
const scrollContainer = ref<HTMLElement>()
const { virtualizer: rowVirtualizer } = useVirtualRows({
  scrollElement: scrollContainer,
  count: computed(() => props.rows.length),
  estimateSize: measuredRowHeight,
})

/** 显式滚动 API：调用方在搜索、筛选或切换数据源后可稳定重置虚拟窗口。 */
function scrollToIndex(index: number): void {
  const safeIndex = Math.max(0, Math.min(index, Math.max(0, props.rows.length - 1)))
  const virtualizer = rowVirtualizer.value as unknown as {
    scrollToIndex(index: number, options?: { align: 'start' | 'center' | 'end' | 'auto' }): void
    scrollToOffset?: (offset: number) => void
  }
  if (safeIndex === 0) {
    // scrollToIndex 可能在下一帧依据旧测量值恢复偏移；先走虚拟器 API，再强制校准 DOM，
    // 并在微任务中再校准一次，确保“相同结果数”的搜索也不会停留在列表底部。
    virtualizer.scrollToOffset?.(0)
    virtualizer.scrollToIndex(0, { align: 'start' })
    if (scrollContainer.value) scrollContainer.value.scrollTop = 0
    Promise.resolve().then(() => {
      if (scrollContainer.value) scrollContainer.value.scrollTop = 0
    })
    setTimeout(() => {
      virtualizer.scrollToOffset?.(0)
      if (scrollContainer.value) scrollContainer.value.scrollTop = 0
    }, 0)
    return
  }
  virtualizer.scrollToIndex(safeIndex, { align: 'start' })
}

function scrollToTop(): void {
  scrollToIndex(0)
}

defineExpose({ scrollToIndex, scrollToTop })

/** 在挂载与容器尺寸变化时实测一次真实行高并广播，保证所有单行均一且拖拽滚动条平滑 */
function updateRowHeight(): void {
  const container = scrollContainer.value
  if (!container) return
  const firstRow = container.querySelector('tbody tr:not([aria-hidden])') as HTMLElement | null
  if (firstRow) {
    const h = firstRow.getBoundingClientRect().height
    if (h > 0 && Math.abs(h - measuredRowHeight.value) > 0.5) {
      measuredRowHeight.value = h
      rowVirtualizer.value.measure()
    }
  }
}

onMounted(() => {
  nextTick(updateRowHeight)
  if (typeof ResizeObserver !== 'undefined' && scrollContainer.value) {
    const observer = new ResizeObserver(() => updateRowHeight())
    observer.observe(scrollContainer.value)
    onBeforeUnmount(() => observer.disconnect())
  }
})

// 搜索/筛选结果切换后回到列表顶部，避免虚拟列表保留旧滚动偏移而显示空白。
watch(
  () => props.rows,
  async () => {
    await nextTick()
    scrollToTop()
  },
)

/** 取虚拟行索引对应的原始行数据（每个虚拟项即单行）。 */
function rowAt(index: number): T | undefined {
  return props.rows[index]
}

/**
 * 可见列的内联宽度（百分比）：按权重相对占比归一化到 100%，
 * 配合 table-fixed 保证列宽稳定且始终从左到右铺满整表。
 */
const columnWidths = computed(() => {
  return getColumnWidths(props.columns, Boolean(props.selectedIds))
})
/** 取顶部/底部虚拟占位高度（置于 tbody 内部占位行，不再影响 table 外部结构）。 */
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
    class="flex min-h-0 flex-col overflow-hidden rounded-none border-[0.16cqh] border-line bg-white"
  >
    <!-- 表格区：表头吸顶，表体滚动（容器高度由调用方控制）；内部只挂载可视行。
         顶部/底部虚拟占位用 table 外的 div 承载：table-fixed 的列宽由「表格第一行」决定，
         若占位 tr/td（colspan）成为第一行，列宽将无法从 th 读取，会产生错位空白。 -->
    <div
      ref="scrollContainer"
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-stable"
    >
      <table class="w-full table-fixed border-collapse text-left text-fs-12 text-navy">
        <colgroup>
          <col v-if="props.selectedIds" class="w-[3.2em]" />
          <col
            v-for="column in props.columns"
            :key="column.key"
            :style="{ width: columnWidths.get(column.key) }"
          />
        </colgroup>
        <thead class="sticky top-0 z-10 border-b-[0.2cqh] border-line bg-line">
          <tr>
            <!-- 行首选择列表头：多选显示三态复选框；单选仅保留同宽列与无障碍列名。 -->
            <th v-if="props.selectedIds" class="w-[3.2em] px-[0.5em] py-[0.55cqh]">
              <input
                v-if="activeSelectionMode === 'multiple'"
                type="checkbox"
                class="h-[1.6cqh] w-[1.6cqh] rounded-none accent-blue"
                :disabled="props.selectionDisabled"
                :checked="props.selectAllState === 'all'"
                :indeterminate="props.selectAllState === 'some'"
                :aria-label="selectAllAria"
                @change="emit('toggle-all')"
              />
              <span v-else class="sr-only">{{ selectAllAria }}</span>
            </th>
            <th
              v-for="column in props.columns"
              :key="column.key"
              class="whitespace-nowrap px-[0.6em] py-[0.55cqh] font-bold text-muted"
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
                class="inline-flex items-center gap-[0.25em] rounded-none px-[0.25em] py-[0.1cqh] hover:bg-line"
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
            v-for="virtualRow in rowVirtualizer.getVirtualItems()"
            :key="String(virtualRow.key)"
            :data-index="virtualRow.index"
            class="border-t-[0.12cqh] border-t-line ui-feedback hover:bg-sky"
            :class="
              rowAt(virtualRow.index) && isSelected(rowAt(virtualRow.index)!)
                ? 'bg-sky'
                : 'bg-white'
            "
          >
            <!-- 行首选择列：多选用于词条批量管理，单选用于互斥的词库包选择。 -->
            <td v-if="props.selectedIds" class="px-[0.5em] py-[0.4cqh]">
              <input
                :type="activeSelectionMode === 'single' ? 'radio' : 'checkbox'"
                :name="activeSelectionMode === 'single' ? selectionGroupName : undefined"
                class="h-[1.6cqh] w-[1.6cqh] accent-blue disabled:cursor-not-allowed disabled:opacity-60"
                :class="{ 'rounded-none': activeSelectionMode === 'multiple' }"
                :disabled="props.selectionDisabled"
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
        <span v-if="props.emptyHint">{{ props.emptyHint }}</span>
      </div>
    </div>
  </div>
</template>
