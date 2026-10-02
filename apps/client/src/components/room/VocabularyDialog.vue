<!--
  本局词库管理弹窗 —— 统一列表（表格）视图。
  展示形式固定为表格：多字段陈列 + 表头排序 + 分类筛选，全部字段恒显示（无列显隐）；
  - 房主：可搜索/筛选、复选框批量选择、确认保存（恢复默认全选）；
  - 非房主：可打开查看本局词库，但不可选择（只读：无复选框、无保存，仅能搜索/筛选浏览）。
  分类筛选与搜索框可叠加生效（取交集）。

  工具栏单行布局：搜索框占左半行，右半行为筛选功能按钮（仅词条模式；
  词库包模式该侧留空，可用词库数只展示在页脚，避免与页脚重复计数）。
  批量选择收敛为一个「统一三态复选框」放于表格表头，作用于当前搜索+筛选结果（无筛选时即全部词条）。
  词库统计（全部/搜索结果/已选）合并到底部操作栏左侧，表格区不单独占行。
  选择集合由父组件持有；展示文案来自 @draw-guess/strings，上限与默认值来自配置包。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { Library, ListFilter, Tags } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { MIN_SELECTED_VOCABULARY_WORDS, type VocabularyWord } from '@draw-guess/shared'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import SectionHeader from '@/components/common/SectionHeader.vue'
import SearchInput from '@/components/common/SearchInput.vue'
import RoundIconButton from '@/components/common/RoundIconButton.vue'
import type { ScrollableTable } from '@/components/common/data-table.types'
import MultiSelectPopover, {
  type MultiSelectOption,
} from '@/components/common/MultiSelectPopover.vue'
import type { DataTableColumn } from '@/components/common/data-table.types'
import VocabTableView from '@/components/room/VocabTableView.vue'
import VocabPackageTableView from '@/components/room/VocabPackageTableView.vue'
import { useGameStore } from '@/stores/game'
import { useVocabularyDialogSession } from '@/composables/useVocabularyDialogSession'
import { useVocabularyPackages } from '@/composables/useVocabularyPackages'
import { useVocabularyQuery } from '@/composables/useVocabularyQuery'
import { useVocabularySelection } from '@/composables/useVocabularySelection'

const open = defineModel<boolean>('open', { default: false })
const loading = defineModel<boolean>('loading', { default: false })
const emit = defineEmits<{ close: [] }>()
const store = useGameStore()

// ---- 词库弹窗内部状态 ----
const viewMode = ref<'words' | 'packages'>('words')
const wordTable = ref<ScrollableTable>()
const packageTable = ref<ScrollableTable>()
/** 只读标志：非房主可打开查看，但不可选择词条（无复选框/无保存）。 */
const isReadOnly = computed(() => !store.isHost)
const activePackageId = computed(() => store.vocabulary?.packageId ?? '')
const words = computed(() => store.vocabulary?.items ?? [])
const packages = computed(() => store.vocabulary?.packages ?? [])
const selection = useVocabularySelection(() => isReadOnly.value)
const selectedIds = selection.selectedIds
const toggleWord = selection.toggle
const setSelection = selection.setSelection

/**
 * 全部词条 ID。统一走可选链而非 `store.vocabulary!` 非空断言：
 * 弹窗只按 `showVocabulary` 挂载，若词库拉取尚未完成或失败，
 * 直接断言会在点击「恢复默认/确认选择」时抛 TypeError。
 */
const allWordIds = computed(() => (store.vocabulary?.items ?? []).map((item) => item.id))

/**
 * 表格列定义（label 全部来自 strings；所有字段恒显示，无列显隐）。
 * weight：列宽相对权重，配合 DataTable 的权重归一化铺满整表。
 */
const allColumns = computed<DataTableColumn<VocabularyWord>[]>(() => [
  { key: 'text', label: strings.ui.room.vocabColumnText, weight: 18 },
  { key: 'category', label: strings.ui.room.vocabColumnCategories, weight: 11 },
  {
    key: 'aliases',
    label: strings.ui.room.vocabColumnAliases,
    weight: 20,
    sortValue: (word) => word.aliases.join(','),
  },
])

const query = useVocabularyQuery({
  words,
  packages,
  columns: allColumns,
  debounceMs: store.config.ui.searchDebounceMs,
})
const {
  search,
  searchKeyword,
  filterSelections,
  filteredWords,
  wordRows: tableRows,
  filteredPackages,
  sortKey,
  sortDir,
  handleSort,
} = query
const packageState = useVocabularyPackages({
  packages: filteredPackages,
  activePackageId,
  isReadOnly: () => isReadOnly.value,
  select: (packageId) => store.selectVocabularyPackage(packageId),
  onSelected: async () => {
    if (store.vocabulary) selection.reset(store.vocabulary.selectedIds)
    await nextTick()
    packageTable.value?.scrollToTop()
  },
})
const {
  pendingPackageId,
  displayedPackageId,
  rows: tablePackageRows,
  sortKey: packageSortKey,
  sortDir: packageSortDir,
  handleSort: handlePackageSort,
  select: handleSelectPackage,
} = packageState

function toggleSelectAll(): void {
  selection.toggleAll(filteredWords.value)
}

/** 字段筛选定义：只有分类（来自词库白名单 categoryEnum）——难度与可绘制性已随词库瘦身移除。 */
const filterDefs = computed<
  Array<{ key: string; label: string; icon: Component; options: MultiSelectOption[] }>
>(() => {
  return [
    {
      key: 'category',
      label: strings.ui.room.vocabColumnCategories,
      icon: Tags,
      options: (store.vocabulary?.categories ?? []).map((category) => ({
        value: category,
        label: category,
      })),
    },
  ]
})

/** 更新某个筛选字段的选中集合（MultiSelectPopover 受控回写）。 */
function updateFilter(key: string, values: string[]): void {
  query.updateFilter(key, values)
  void nextTick(() => wordTable.value?.scrollToTop())
}
watch(searchKeyword, () => {
  void nextTick(() =>
    viewMode.value === 'words' ? wordTable.value?.scrollToTop() : packageTable.value?.scrollToTop(),
  )
})

/**
 * 视图模式切换的**唯一入口**（词条列表 <-> 词库包选择）：
 * 工具栏圆形切换钮与底部「切换到词条/词库包」按钮都必须走本函数，
 * 行为恒为「清搜索词 + 目标列表滚动复位 + 切模式」。
 * 历史上底部按钮直接改 viewMode、绕过清理逻辑，导致两条路径不等价
 * （词库包模式输入过搜索词后从底部返回，搜索词会残留并误筛词条列表）。
 */
function switchViewMode(mode: 'words' | 'packages'): void {
  viewMode.value = mode
  query.clearSearch()
  void nextTick(() =>
    mode === 'words' ? wordTable.value?.scrollToTop() : packageTable.value?.scrollToTop(),
  )
}

/**
 * 会话生命周期（打开→拉取→失效校验→关闭→保存）收敛在 composable；
 * 本组件只提供协作者与「加载成功后重置视图」的钩子。
 */
const { handleClose, saveVocabulary } = useVocabularyDialogSession({
  open,
  loading,
  store,
  selectedIds,
  isReadOnly: () => isReadOnly.value,
  cancelInFlight: () => {
    query.cancel()
    store.cancelVocabularyRequests()
    packageState.resetPending()
  },
  emitClose: () => emit('close'),
  onLoaded: async () => {
    const vocab = store.vocabulary
    if (vocab) selection.reset(vocab.selectedIds)
    query.clearSearch()
    viewMode.value = 'words'
    await nextTick()
  },
})
</script>

<template>
  <!-- 弹窗基于 BaseDialog 外壳；仅在「已打开且词库已拉取」时渲染内容，避免加载中的空遮罩。 -->
  <BaseDialog
    :open="open && !!store.vocabulary"
    width-class="w-[88cqw]"
    section-class="h-[84cqh]"
    labelledby="vocab-title"
    :close-aria="strings.a11y.room.vocabCloseAria"
    @close="handleClose"
  >
    <template #header>
      <SectionHeader
        id="vocab-title"
        :eyebrow="strings.ui.room.vocabLabel"
        :title="
          viewMode === 'packages'
            ? strings.ui.room.vocabSwitchToPackages
            : isReadOnly
              ? strings.ui.room.vocabTitleReadonly
              : strings.ui.room.vocabTitle
        "
      ></SectionHeader>
    </template>

    <template v-if="store.vocabulary">
      <div class="flex min-h-0 flex-1 flex-col">
        <!-- 工具栏：搜索框占左半行（含切换词库选择的圆形小按钮），右半行为功能区 -->
        <div
          class="flex items-center gap-[0.6em] py-[1.1cqh] px-[1.7em] border-b-[0.18cqh] border-b-line"
        >
          <div class="flex w-1/2 min-w-0 items-center gap-[0.6em]">
            <div class="min-w-0 flex-1">
              <SearchInput
                v-model="search"
                :placeholder="
                  viewMode === 'words'
                    ? strings.ui.room.vocabSearchPlaceholder
                    : strings.ui.room.vocabPackageSearchPlaceholder
                "
                :aria-label="
                  viewMode === 'words'
                    ? strings.a11y.room.vocabSearchAria
                    : strings.a11y.room.vocabPackageSearchAria
                "
              />
            </div>
            <!-- 圆形切换小按钮：在词条管理与词库包选择之间切换 -->
            <RoundIconButton
              :label="
                viewMode === 'words'
                  ? strings.a11y.room.vocabSwitchToPackages
                  : strings.a11y.room.vocabSwitchToWords
              "
              :title="
                viewMode === 'words'
                  ? strings.a11y.room.vocabSwitchToPackages
                  : strings.a11y.room.vocabSwitchToWords
              "
              audio-feedback="select"
              @click="switchViewMode(viewMode === 'words' ? 'packages' : 'words')"
            >
              <Library v-if="viewMode === 'words'" class="h-[2.2cqh] w-[2.2cqh]" />
              <ListFilter v-else class="h-[2.2cqh] w-[2.2cqh]" />
            </RoundIconButton>
          </div>
          <!-- 字段筛选：分类（多选，仅词条模式可用）；纯图标 + 悬浮说明 -->
          <div v-if="viewMode === 'words'" class="flex w-1/2 min-w-0 items-center gap-[0.45em]">
            <MultiSelectPopover
              v-for="filter in filterDefs"
              :key="filter.key"
              :label="filter.label"
              :trigger-aria="strings.a11y.room.vocabFilterAria(filter.label)"
              :select-all-label="strings.ui.room.vocabSelectAllShort"
              :deselect-all-label="strings.ui.room.vocabDeselectAllShort"
              :options="filter.options"
              :selected="filterSelections[filter.key] ?? []"
              :icon="filter.icon"
              :highlight="true"
              placement="bottom"
              @update:selected="updateFilter(filter.key, $event)"
            />
          </div>
        </div>

        <!-- 内容区：根据 viewMode 切换词条表格与词库包选择表格 -->
        <VocabTableView
          v-if="viewMode === 'words'"
          ref="wordTable"
          :rows="tableRows"
          :columns="allColumns"
          :selected-ids="isReadOnly ? undefined : selectedIds"
          :sort-key="sortKey"
          :sort-dir="sortDir"
          @sort="handleSort"
          @toggle="toggleWord"
          @toggle-all="toggleSelectAll"
        />
        <VocabPackageTableView
          v-else
          ref="packageTable"
          :rows="tablePackageRows"
          :selected-package-id="displayedPackageId"
          :sort-key="packageSortKey"
          :sort-dir="packageSortDir"
          :is-read-only="isReadOnly"
          :selection-pending="!!pendingPackageId"
          @sort="handlePackageSort"
          @select="handleSelectPackage"
        />
      </div>
    </template>

    <template #footer>
      <!-- 词库包模式底部操作 -->
      <template v-if="viewMode === 'packages'">
        <p class="mr-auto min-w-0 text-muted text-fs-12" role="status">
          {{ strings.ui.room.vocabPackageTotal(store.vocabulary?.packages.length ?? 0) }}
        </p>
        <AppButton
          variant="secondary"
          type="button"
          audio-feedback="select"
          @click="switchViewMode('words')"
        >
          {{ strings.ui.room.vocabSwitchToWords }}
        </AppButton>
      </template>
      <!-- 词条管理模式：只读玩家仅提示不可编辑 -->
      <template v-else-if="isReadOnly">
        <p class="mr-auto text-muted text-fs-12" role="status">
          {{ strings.ui.room.vocabReadonlyHint }}
        </p>
      </template>
      <template v-else>
        <!-- 统计：全部 / 搜索结果 / 已选（移到页脚左侧，数字固定 4 位等宽防抖） -->
        <p class="mr-auto min-w-0 text-muted text-fs-12" role="status">
          {{ strings.ui.room.vocabAll }}
          <b class="inline-block min-w-[4ch] text-center tabular-nums text-blue">{{
            store.vocabulary?.items.length ?? 0
          }}</b>
          {{ strings.ui.common.listSeparator }} {{ strings.ui.room.vocabResults }}
          <b class="inline-block min-w-[4ch] text-center tabular-nums text-blue">{{
            filteredWords.length
          }}</b>
          {{ strings.ui.common.listSeparator }} {{ strings.ui.room.vocabSelected }}
          <b class="inline-block min-w-[4ch] text-center tabular-nums text-blue">{{
            selectedIds.size
          }}</b>
          <span
            v-if="selectedIds.size < MIN_SELECTED_VOCABULARY_WORDS"
            class="ml-[1em] font-bold text-red"
            >{{ strings.ui.room.vocabMinHint(MIN_SELECTED_VOCABULARY_WORDS) }}</span
          >
        </p>
        <AppButton variant="secondary" type="button" @click="setSelection(allWordIds, true)">
          {{ strings.ui.room.restoreDefault }}
        </AppButton>
        <AppButton
          variant="primary"
          type="button"
          :disabled="selectedIds.size < MIN_SELECTED_VOCABULARY_WORDS"
          @click="saveVocabulary"
        >
          {{ strings.ui.room.confirmSelection }}
        </AppButton>
      </template>
    </template>
  </BaseDialog>
</template>
