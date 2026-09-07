<script setup lang="ts">
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'

export interface DataTableHeaderColumn {
  key: string
  label: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
}

defineProps<{
  columns: DataTableHeaderColumn[]
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
      <th v-if="hasSelection" class="w-[3.2em] px-[0.5em] py-[0.55cqh]">
        <input
          v-if="selectionMode === 'multiple'"
          type="checkbox"
          class="h-[1.6cqh] w-[1.6cqh] rounded-none accent-blue"
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
        :class="{
          'text-center': column.align === 'center',
          'text-right': column.align === 'right',
        }"
        :aria-sort="
          sortKey === column.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
        "
      >
        <button
          v-if="column.sortable !== false"
          type="button"
          class="inline-flex items-center gap-[0.25em] rounded-none px-[0.25em] py-[0.1cqh] hover:bg-line"
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
