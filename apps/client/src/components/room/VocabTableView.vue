<!--
  词库管理·表格视图（从 VocabularyDialog 拆出的子组件，基于通用 DataTable 组件）。
  与散列视图（VocabGridView）共享选择集合与筛选结果，提供多字段陈列：
  - 列定义与显隐由父组件（VocabularyDialog）持有并过滤后传入；
  - 排序状态由父组件维护，点击表头经 DataTable 上抛后由父组件翻转；
  - 各富内容列（分类徽章/难度星级/别称灰字等）通过 DataTable 的具名插槽渲染。
-->
<script setup lang="ts">
import { strings } from '@draw-guess/strings'
import type { VocabularyWord } from '@draw-guess/shared'
import type { DataTableColumn } from '@/components/common/DataTable.vue'
import DataTable from '@/components/common/DataTable.vue'
import DifficultyStars from '@/components/common/DifficultyStars.vue'

const props = defineProps<{
  /** 待展示词条（父组件已完成搜索/筛选/排序） */
  rows: VocabularyWord[]
  /** 可见列定义（父组件按「显示字段」过滤后的结果） */
  columns: DataTableColumn<VocabularyWord>[]
  /** 已选词条 ID 集合（受控） */
  selectedIds: Set<string>
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
}>()
</script>

<template>
  <!-- 表格容器：占满剩余高度，滚动由 DataTable 内部处理 -->
  <DataTable
    class="min-h-0 flex-1"
    :columns="props.columns"
    :rows="props.rows"
    row-key="id"
    :sort-key="props.sortKey"
    :sort-dir="props.sortDir"
    :selected-ids="props.selectedIds"
    :empty-hint="strings.room.vocabColumnHiddenNote"
    @sort="emit('sort', $event)"
    @toggle="emit('toggle', $event)"
  >
    <!-- 词面列：主文字加粗突出 -->
    <template #cell-text="{ row }">
      <span class="block truncate font-black text-navy" :title="row.text">{{ row.text }}</span>
    </template>
    <!-- 分类列：蓝色小徽章（允许多分类并排） -->
    <template #cell-categories="{ row }">
      <span v-if="row.categories.length" class="flex flex-wrap gap-[0.25em]">
        <span
          v-for="category in row.categories"
          :key="category"
          class="rounded-full bg-sky px-[0.5em] py-[0.08cqh] text-[0.9em] font-extrabold text-blue"
          >{{ category }}</span
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
        :title="row.aliases.join('、')"
        >{{ row.aliases.join('、') }}</span
      >
      <span v-else class="text-muted">{{ strings.room.vocabAliasEmpty }}</span>
    </template>
    <!-- 标签列：石板色小徽章 -->
    <template #cell-tags="{ row }">
      <span v-if="row.tags.length" class="flex flex-wrap gap-[0.25em]">
        <span
          v-for="tag in row.tags"
          :key="tag"
          class="rounded-full bg-line px-[0.5em] py-[0.08cqh] text-[0.9em] font-bold text-muted"
          >{{ tag }}</span
        >
      </span>
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
