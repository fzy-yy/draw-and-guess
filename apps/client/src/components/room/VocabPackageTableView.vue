<!--
  词库管理·词库包选择表格视图（基于通用 DataTable 组件）。
  列表展示 vocabulary 目录下检测到的全部词库信息。
  行首复选框支持多选词库包与当前选中状态提示；字段按顺序为名称、作者、词数、描述、备注、版本、日期。
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
  /** 当前已选中的词库包 ID 集合 */
  selectedPackageIds?: Set<string> | string[]
  /** 兼容单选时的词库包 ID */
  selectedPackageId?: string
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
  /** 行勾选：只上抛这一条事件（宿主只绑它，重复上抛会让一次点击执行两次切换）。 */
  toggle: [packageId: string]
}>()

const columns: DataTableColumn<VocabularyPackageInfo>[] = [
  { key: 'name', label: strings.ui.room.vocabPackageColumnName, weight: 18 },
  { key: 'author', label: strings.ui.room.vocabPackageColumnAuthor, weight: 12 },
  { key: 'wordCount', label: strings.ui.room.vocabPackageColumnWordCount, weight: 10 },
  { key: 'description', label: strings.ui.room.vocabPackageColumnDescription, weight: 24 },
  { key: 'remark', label: strings.ui.room.vocabPackageColumnRemark, weight: 16 },
  { key: 'version', label: strings.ui.room.vocabPackageColumnVersion, weight: 8 },
  { key: 'updatedAt', label: strings.ui.room.vocabPackageColumnUpdatedAt, weight: 12 },
]

/** DataTable 以 Set 作为统一受控选择接口；支持多选词库包。 */
const activeSelectedPackageIds = computed<Set<string>>(() => {
  if (props.selectedPackageIds instanceof Set) return props.selectedPackageIds
  if (Array.isArray(props.selectedPackageIds)) return new Set(props.selectedPackageIds)
  if (props.selectedPackageId) return new Set([props.selectedPackageId])
  return new Set<string>()
})

function handleToggle(packageId: string): void {
  emit('toggle', packageId)
}
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
    :selected-ids="activeSelectedPackageIds"
    selection-mode="multiple"
    :selection-disabled="props.isReadOnly || props.selectionPending"
    :select-all-aria="strings.a11y.room.vocabPackageSelectionColumn"
    :empty-text="strings.ui.room.vocabPackagesEmpty"
    :row-aria="(row) => strings.a11y.room.vocabPackageSelectAria(row.name)"
    @sort="emit('sort', $event)"
    @toggle="handleToggle($event)"
  >
    <!-- 词库名称：加粗居中展示 -->
    <template #cell-name="{ row }">
      <span class="block truncate text-center font-bold text-navy" :title="row.name">{{
        row.name
      }}</span>
    </template>

    <!-- 作者：居中展示 -->
    <template #cell-author="{ row }">
      <span
        class="block truncate text-center text-navy"
        :title="row.author || strings.a11y.common.emptyDash"
        >{{ row.author || strings.ui.common.emptyDash }}</span
      >
    </template>

    <!-- 词数：等宽数字居中展示 -->
    <template #cell-wordCount="{ row }">
      <span class="block text-center font-bold tabular-nums text-blue">{{ row.wordCount }}</span>
    </template>

    <!-- 词库描述：灰字居中说明 -->
    <template #cell-description="{ row }">
      <span
        class="block truncate text-center text-muted"
        :title="row.description || strings.a11y.common.emptyDash"
        >{{ row.description || strings.ui.common.emptyDash }}</span
      >
    </template>

    <!-- 备注：灰字居中说明 -->
    <template #cell-remark="{ row }">
      <span
        class="block truncate text-center text-muted"
        :title="row.remark || strings.a11y.common.emptyDash"
        >{{ row.remark || strings.ui.common.emptyDash }}</span
      >
    </template>

    <!-- 版本号：等宽居中显示 -->
    <template #cell-version="{ row }">
      <span class="block text-center tabular-nums text-navy">{{
        row.version || strings.ui.common.emptyDash
      }}</span>
    </template>

    <!-- 更新日期：等宽居中显示 -->
    <template #cell-updatedAt="{ row }">
      <span class="block text-center tabular-nums text-muted">{{
        row.updatedAt || strings.ui.common.emptyDash
      }}</span>
    </template>
  </DataTable>
</template>
