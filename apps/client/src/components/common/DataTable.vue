<!--
  通用数据表格组件（可复用，泛型化）。
  职责边界（保持「纯展示」，业务状态全部由调用方持有，保证组件可嵌入任意场景）：
  - 列由调用方以 columns 定义（key/label/排序取值/对齐/宽度），并预先完成「列显隐」过滤；
  - 表头点击上抛 sort 事件（升/降序切换由父组件维护 sortKey/sortDir 后回传）；
  - 单元格支持两种渲染方式：具名插槽 `cell-<key>`（自定义富内容）或缺省的文本渲染；
  - 可选行首复选列：传入 selectedIds 后显示，勾选变化上抛 toggle 事件；
  - 空态文案、行悬停高亮、斑马纹等视觉细节内置，与游戏舞台主题协调。
  典型用法见 components/room/VocabTableView.vue（词库管理表格视图）。
-->
<script setup lang="ts" generic="T extends object">
import { computed } from 'vue'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'

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
  /** 列宽（Tailwind w-* 类），如 'w-[22%]'；缺省自动 */
  widthClass?: string
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
  /** 空态文案 */
  emptyText?: string
  /** 空态补充说明（如「可在显示字段中开启更多列」） */
  emptyHint?: string
}>()

// 注意：泛型组件不用 withDefaults —— 它会破坏 vue-tsc 对 T 的推断（回落到约束类型），
// 缺省值改在模板/计算中用 ?? 兑底。
const activeSortKey = computed(() => props.sortKey ?? null)
const activeSortDir = computed(() => props.sortDir ?? 'asc')

const emit = defineEmits<{
  /** 点击表头：上抛列 key，升/降序切换逻辑由父组件裁决 */
  sort: [key: string]
  /** 行首复选列勾选变化：上抛该行唯一键 */
  toggle: [id: string]
}>()

/** 判断某行是否处于选中态（行首复选列） */
function isSelected(row: T): boolean {
  return props.selectedIds?.has(String(row[props.rowKey])) ?? false
}

/** 单元格缺省渲染：数组 join、其余 String 化；富内容请用具名插槽 cell-<key> 覆盖。 */
function displayValue(row: T, column: DataTableColumn<T>): string {
  const value = row[column.key]
  if (Array.isArray(value)) return value.length ? value.join('、') : '—'
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
}
</script>

<template>
  <div
    class="flex min-h-0 flex-col overflow-hidden rounded-[0.7em] border-[0.16cqh] border-line bg-white"
  >
    <!-- 表格区：表头吸顶，表体滚动（容器高度由调用方控制） -->
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
      <table class="w-full border-collapse text-left text-[0.72em] text-ink">
        <thead class="sticky top-0 z-10 bg-slate-100 shadow-[0_0.2cqh_0_#e2e8f0]">
          <tr>
            <!-- 可选行首复选列表头（仅占位，无全选语义——全选由工具栏按钮承担） -->
            <th
              v-if="props.selectedIds"
              class="w-[3.2em] px-[0.5em] py-[0.55cqh]"
              aria-hidden="true"
            ></th>
            <th
              v-for="column in props.columns"
              :key="column.key"
              class="whitespace-nowrap px-[0.6em] py-[0.55cqh] font-black text-slate-600"
              :class="[
                column.widthClass,
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
                class="inline-flex items-center gap-[0.25em] rounded-[0.3em] px-[0.25em] py-[0.1cqh] hover:bg-slate-200"
                :aria-label="strings.room.vocabSortAria(column.label)"
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
                <ArrowUpDown
                  v-else
                  class="h-[1.2cqh] w-[1.2cqh] text-slate-400"
                  aria-hidden="true"
                />
              </button>
              <span v-else>{{ column.label }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in props.rows"
            :key="String(row[props.rowKey])"
            class="border-t-[0.12cqh] border-t-slate-100 transition-colors duration-[120ms] hover:bg-sky"
            :class="isSelected(row) ? '!bg-sky-100' : ''"
          >
            <!-- 行首复选列：词库选择与表格浏览共存，勾选即写入父组件的已选集合 -->
            <td v-if="props.selectedIds" class="px-[0.5em] py-[0.4cqh]">
              <input
                type="checkbox"
                class="h-[1.6cqh] w-[1.6cqh] accent-blue"
                :checked="isSelected(row)"
                :aria-label="String(row[props.rowKey])"
                @change="emit('toggle', String(row[props.rowKey]))"
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
              <slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]">
                <span class="block truncate" :title="displayValue(row, column)">{{
                  displayValue(row, column)
                }}</span>
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
      <!-- 空态：无数据或筛选无结果 -->
      <div
        v-if="!props.rows.length"
        class="flex flex-col items-center gap-[0.4cqh] px-[1em] py-[3cqh] text-center text-[0.72em] text-muted"
      >
        <b>{{ props.emptyText || strings.room.vocabNoMatch }}</b>
        <span v-if="props.emptyHint">{{ props.emptyHint }}</span>
      </div>
    </div>
  </div>
</template>
