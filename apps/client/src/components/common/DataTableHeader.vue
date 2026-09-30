<!--
  DataTable 的吸顶表头：列名展示、排序按钮与表头统一复选框（三态）。
  列类型不再是本地手抄：本文件只消费 key/label/sortable 三个字段，
  统一取 data-table.types 的 DataTableHeaderColumn（由 DataTableColumn Pick 派生），
  与共享列定义保持单源，避免两处同形接口各自漂移。
-->
<script setup lang="ts" generic="T extends object">
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { DataTableHeaderColumn } from './data-table.types'
import { DATA_TABLE_SELECTION_COLUMN_WIDTH } from './data-table-layout'

defineProps<{
  columns: DataTableHeaderColumn<T>[]
  widths: Map<string, string>
  hasSelection: boolean
  selectionMode: 'multiple' | 'single'
  selectionDisabled?: boolean
  selectAllState?: 'all' | 'some' | 'none'
  selectAllAria: string
  sortKey: string | null
  sortDir: 'asc' | 'desc'
}>()
const emit = defineEmits<{ sort: [key: string]; 'toggle-all': [] }>()
</script>

<template>
  <thead class="sticky top-0 z-10 border-b-[0.2cqh] border-line bg-line">
    <tr>
      <th
        v-if="hasSelection"
        class="px-[0.5em] py-[0.55cqh]"
        :style="{ width: DATA_TABLE_SELECTION_COLUMN_WIDTH }"
      >
        <!-- 表格内密集控件：视觉尺寸设 16px 下限（responsive.minDenseTargetPx），避免小舞台下缩到看不见 -->
        <input
          v-if="selectionMode === 'multiple'"
          type="checkbox"
          class="h-[max(1.6cqh,16px)] w-[max(1.6cqh,16px)] rounded-none accent-blue"
          :disabled="selectionDisabled"
          :checked="selectAllState === 'all'"
          :indeterminate="selectAllState === 'some'"
          :aria-label="selectAllAria"
          @change="emit('toggle-all')"
        />
        <span v-else class="sr-only">{{ selectAllAria }}</span>
      </th>
      <th
        v-for="column in columns"
        :key="column.key"
        class="whitespace-nowrap px-[0.6em] py-[0.55cqh] font-bold text-muted"
        :style="{ width: widths.get(column.key) }"
        :aria-sort="
          sortKey === column.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
        "
      >
        <!-- 排序语义是反向开关：sortable 缺省（undefined）即可排序，显式 false 才禁用（约定见 data-table.types 的 DataTableColumn.sortable） -->
        <button
          v-if="column.sortable !== false"
          type="button"
          class="inline-flex items-center gap-[0.25em] rounded-none px-[0.25em] py-[max(0.1cqh,0.3em)] hover:bg-line"
          :aria-label="strings.common.sortByAria(column.label)"
          @click="emit('sort', column.key)"
        >
          {{ column.label }}
          <ArrowUp
            v-if="sortKey === column.key && sortDir === 'asc'"
            class="h-[1.2cqh] w-[1.2cqh] text-blue"
            aria-hidden="true"
          />
          <ArrowDown
            v-else-if="sortKey === column.key && sortDir === 'desc'"
            class="h-[1.2cqh] w-[1.2cqh] text-blue"
            aria-hidden="true"
          />
          <ArrowUpDown v-else class="h-[1.2cqh] w-[1.2cqh] text-muted" aria-hidden="true" />
        </button>
        <span v-else>{{ column.label }}</span>
      </th>
    </tr>
  </thead>
</template>
