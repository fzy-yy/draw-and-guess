<!--
  词库管理·表格视图（从 VocabularyDialog 拆出的子组件，基于通用 DataTable 组件）。
  作为统一的词库列表视图提供多字段陈列（全部字段恒显示）：
  - 列定义由父组件（VocabularyDialog）持有并传入；
  - 排序状态由父组件维护，点击表头经 DataTable 上抛后由父组件翻转；
  - 行首复选列与表头三态统一复选框由父组件持有选择集合并裁决批量范围
    （非房主只读时不传 selectedIds，复选列整体隐藏）；
  - 各富内容列（分类徽章/难度星级/别称灰字等）通过 DataTable 的具名插槽渲染。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { strings } from '@draw-guess/strings'
import type { VocabularyWord } from '@draw-guess/shared'
import type { DataTableColumn } from '@/components/common/DataTable.vue'
import DataTable from '@/components/common/DataTable.vue'
import DifficultyStars from '@/components/common/DifficultyStars.vue'
import { useSelectAllState } from '@/composables/useSelectAllState'

const props = defineProps<{
  /** 待展示词条（父组件已完成搜索/筛选/排序） */
  rows: VocabularyWord[]
  /** 列定义（父组件持有；全部字段恒显示） */
  columns: DataTableColumn<VocabularyWord>[]
  /** 已选词条 ID 集合（受控）；不传（非房主只读）时复选列与表头统一选框整体隐藏 */
  selectedIds?: Set<string>
  /** 当前排序字段（null = 未排序） */
  sortKey: string | null
  /** 当前排序方向 */
  sortDir: 'asc' | 'desc'
}>()

const emit = defineEmits<{
  /** 表头排序事件透传（DataTable → 本组件 → 父组件） */
  sort: [key: string]
  /** 行首复选列勾选透传 */
  toggle: [id: string]
  /** 表头统一复选框点击透传（批量全选/取消范围由父组件裁决） */
  'toggle-all': []
}>()

/** 表头统一复选框三态：房主可选中时由父组件选择集合判定；只读（无 selectedIds）时恒为未选。
 *  空集合兜底为「未选」，保证三态逻辑在无选中数据时不抛错。 */
const selectedSet = computed(() => props.selectedIds ?? new Set<string>())
const selectAllState = useSelectAllState(
  computed(() => props.rows),
  selectedSet,
)
</script>

<template>
  <!-- 表格容器：占满剩余高度，滚动与虚拟化由 DataTable 内部处理 -->
  <DataTable
    class="min-h-0 flex-1"
    :columns="props.columns"
    :rows="props.rows"
    row-key="id"
    :sort-key="props.sortKey"
    :sort-dir="props.sortDir"
    :selected-ids="props.selectedIds"
    :select-all-state="selectAllState"
    :select-all-aria="strings.room.vocabToggleAllAria"
    :empty-text="strings.room.vocabNoMatch"
    :row-aria="(row) => row.text"
    @sort="emit('sort', $event)"
    @toggle="emit('toggle', $event)"
    @toggle-all="emit('toggle-all')"
  >
    <!-- 词面列：主文字加粗突出 -->
    <template #cell-text="{ row }">
      <span class="block truncate font-black text-navy" :title="row.text">{{ row.text }}</span>
    </template>
    <!-- 分类列：蓝色小徽章（词库单词条仅一个分类） -->
    <template #cell-category="{ row }">
      <span v-if="row.category" class="inline-flex max-w-full">
        <span
          class="rounded-full bg-sky px-[0.5em] py-[0.08cqh] text-[0.9em] font-extrabold text-blue"
          >{{ row.category }}</span
        >
      </span>
      <span v-else class="text-muted">{{ strings.room.vocabAliasEmpty }}</span>
    </template>
    <!-- 难度列：复用星级组件（上限来自全局配置） -->
    <template #cell-difficulty="{ row }">
      <DifficultyStars :value="row.difficulty" />
    </template>
    <!-- 别称列：灰字省略，悬停可见全称 -->
    <template #cell-aliases="{ row }">
      <span
        v-if="row.aliases.length"
        class="block truncate text-muted"
        :title="row.aliases.join(strings.common.listSeparator)"
        >{{ row.aliases.join(strings.common.listSeparator) }}</span
      >
      <span v-else class="text-muted">{{ strings.room.vocabAliasEmpty }}</span>
    </template>
    <!-- 时限列：词条级作画秒数 -->
    <template #cell-timeLimit="{ row }">
      <span class="whitespace-nowrap tabular-nums">{{
        strings.common.secondsUnit(row.timeLimit ?? 0)
      }}</span>
    </template>
  </DataTable>
</template>
