<!--
  词库管理·词库包选择表格视图（基于通用 DataTable 组件）。
  列表展示 vocabulary 目录下检测到的全部词库信息。
  行首单选按钮同时承担切换操作与当前词库提示；其后字段按顺序为名称、词数、描述、版本、日期。
-->
<script setup lang="ts">
import { strings } from '@draw-guess/strings'
import type { VocabularyPackageInfo } from '@draw-guess/shared'
import type { DataTableColumn, ScrollableTable } from '@/components/common/data-table.types'
import DataTable from '@/components/common/DataTable.vue'
import { computed, ref } from 'vue'

const props = defineProps<{
  /** 可用词库包列表 */
  rows: VocabularyPackageInfo[]
  /** 当前在单选列中展示的词库包 ID（请求期间可先展示待切换项） */
  selectedPackageId: string
  /** 当前排序字段（null = 未排序） */
  sortKey: string | null
  /** 当前排序方向 */
  sortDir: 'asc' | 'desc'
  /** 是否只读（非房主只读查看，不可切换） */
  isReadOnly?: boolean
  /** 切换请求进行中时禁用重复选择，避免并发请求覆盖新状态。 */
  selectionPending?: boolean
}>()

const emit = defineEmits<{
  sort: [key: string]
  select: [packageId: string]
}>()

const columns: DataTableColumn<VocabularyPackageInfo>[] = [
  { key: 'name', label: strings.ui.room.vocabPackageColumnName, weight: 22 },
  { key: 'wordCount', label: strings.ui.room.vocabPackageColumnWordCount, weight: 12 },
  { key: 'description', label: strings.ui.room.vocabPackageColumnDescription, weight: 34 },
  { key: 'version', label: strings.ui.room.vocabPackageColumnVersion, weight: 12 },
  { key: 'updatedAt', label: strings.ui.room.vocabPackageColumnUpdatedAt, weight: 20 },
]

/** DataTable 以 Set 作为统一受控选择接口；词库包只允许一个激活项。 */
const selectedPackageIds = computed(() => new Set([props.selectedPackageId]))
const table = ref<ScrollableTable>()

defineExpose({
  scrollToTop: () => table.value?.scrollToTop(),
})
</script>

<template>
  <DataTable
    ref="table"
    class="min-h-0 flex-1"
    :columns="columns"
    :rows="props.rows"
    row-key="id"
    :sort-key="props.sortKey"
    :sort-dir="props.sortDir"
    :selected-ids="selectedPackageIds"
    selection-mode="single"
    :selection-disabled="props.isReadOnly || props.selectionPending"
    :select-all-aria="strings.a11y.room.vocabPackageSelectionColumn"
    :empty-text="strings.ui.room.vocabPackagesEmpty"
    :row-aria="(row) => strings.a11y.room.vocabPackageSelectAria(row.name)"
    @sort="emit('sort', $event)"
    @toggle="emit('select', $event)"
  >
    <!-- 词库名称：当前状态由行首单选按钮与选中行底色统一表达。 -->
    <template #cell-name="{ row }">
      <span class="block truncate font-bold text-navy" :title="row.name">{{ row.name }}</span>
    </template>

    <!-- 词数：等宽数字展示 -->
    <template #cell-wordCount="{ row }">
      <b class="tabular-nums text-blue font-bold">{{ row.wordCount }}</b>
    </template>

    <!-- 词库描述：灰字说明 -->
    <template #cell-description="{ row }">
      <span
        class="block truncate text-muted"
        :title="row.description || strings.a11y.common.emptyDash"
        >{{ row.description || strings.ui.common.emptyDash }}</span
      >
    </template>

    <!-- 版本号：等宽显示 -->
    <template #cell-version="{ row }">
      <span class="tabular-nums text-navy">{{ row.version || strings.ui.common.emptyDash }}</span>
    </template>

    <!-- 更新日期：切换操作统一由行首单选按钮承载。 -->
    <template #cell-updatedAt="{ row }">
      <span class="tabular-nums text-muted">{{
        row.updatedAt || strings.ui.common.emptyDash
      }}</span>
    </template>
  </DataTable>
</template>
