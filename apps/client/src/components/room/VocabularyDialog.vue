<!--
  本局词库管理弹窗 —— 统一列表（表格）视图。
  展示形式固定为表格：多字段陈列 + 表头排序 + 分类/难度筛选，全部字段恒显示（无列显隐）；
  - 房主：可搜索/筛选、复选框批量选择、确认保存（恢复默认全选）；
  - 非房主：可打开查看本局词库，但不可选择（只读：无复选框、无保存，仅能搜索/筛选浏览）。
  两类筛选（分类/难度）与搜索框可叠加生效（取交集）。
  工具栏单行布局：搜索框占左半行，右半行为筛选功能按钮。
  批量选择收敛为一个「统一三态复选框」放于表格表头，作用于当前搜索+筛选结果（无筛选时即全部词条）。
  词库统计（全部/搜索结果/已选）合并到底部操作栏左侧，表格区不单独占行。
  选择集合由父组件持有；展示文案来自 @draw-guess/strings，上限与默认值来自配置包。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { Library, ListFilter, Star, Tags } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { MIN_SELECTED_VOCABULARY_WORDS, type VocabularyWord } from '@draw-guess/shared'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import SectionHeader from '@/components/common/SectionHeader.vue'
import SearchInput from '@/components/common/SearchInput.vue'
import RoundIconButton from '@/components/common/RoundIconButton.vue'
import MultiSelectPopover, {
  type MultiSelectOption,
} from '@/components/common/MultiSelectPopover.vue'
import type { DataTableColumn } from '@/components/common/data-table.types'
import VocabTableView from '@/components/room/VocabTableView.vue'
import VocabPackageTableView from '@/components/room/VocabPackageTableView.vue'
import { useGameStore } from '@/stores/game'
import { useVocabularyPackages } from '@/composables/useVocabularyPackages'
import { useVocabularyQuery } from '@/composables/useVocabularyQuery'
import { useVocabularySelection } from '@/composables/useVocabularySelection'

const open = defineModel<boolean>('open', { default: false })
const loading = defineModel<boolean>('loading', { default: false })
const emit = defineEmits<{ close: [] }>()
const store = useGameStore()

// ---- 词库弹窗内部状态 ----
const viewMode = ref<'words' | 'packages'>('words')
const vocabularyLoading = ref(false) // 拉取中标记（防重复打开）
let loadGeneration = 0
type ScrollableTable = { scrollToTop(): void; scrollToIndex(index: number): void }
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

/** 保存词库选择；失败由统一请求层提示，并保留当前弹窗和选择供重试。 */
async function saveVocabulary(): Promise<void> {
  if (isReadOnly.value) return
  const ok = await store.saveVocabulary([...selectedIds.value])
  if (ok) handleClose()
}

/**
 * 表格列定义（label 全部来自 strings；所有字段恒显示，无列显隐）。
 * weight：列宽相对权重，配合 DataTable 的权重归一化铺满整表。
 */
const allColumns = computed<DataTableColumn<VocabularyWord>[]>(() => [
  { key: 'text', label: strings.room.vocabColumnText, weight: 22 },
  { key: 'category', label: strings.room.vocabColumnCategories, weight: 13 },
  { key: 'difficulty', label: strings.room.vocabColumnDifficulty, weight: 12 },
  {
    key: 'aliases',
    label: strings.room.vocabColumnAliases,
    weight: 27,
    sortValue: (word) => word.aliases.join(','),
  },
  {
    key: 'timeLimit',
    label: strings.room.vocabColumnTimeLimit,
    weight: 8,
    sortValue: (word) => word.timeLimit ?? 0,
  },
  {
    key: 'scoreWeight',
    label: strings.room.vocabColumnScoreWeight,
    weight: 8,
    sortValue: (word) => word.scoreWeight ?? 0,
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

/** 字段筛选定义：分类（来自词库白名单 categoryEnum）/ 难度（1~上限）。 */
const filterDefs = computed<
  Array<{ key: string; label: string; icon: Component; options: MultiSelectOption[] }>
>(() => {
  const difficultyMax = store.config.ui.difficultyMax
  return [
    {
      key: 'category',
      label: strings.room.vocabColumnCategories,
      icon: Tags,
      options: (store.vocabulary?.categories ?? []).map((category) => ({
        value: category,
        label: category,
      })),
    },
    {
      key: 'difficulty',
      label: strings.room.vocabColumnDifficulty,
      icon: Star,
      options: Array.from({ length: difficultyMax }, (_item, index) => {
        const value = index + 1
        return { value: String(value), label: strings.room.vocabDifficultyLabel(value) }
      }),
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

/** 切换视图模式：词条列表 <-> 词库包选择 */
function toggleViewMode(): void {
  viewMode.value = viewMode.value === 'words' ? 'packages' : 'words'
  query.clearSearch()
  void nextTick(() =>
    viewMode.value === 'words' ? wordTable.value?.scrollToTop() : packageTable.value?.scrollToTop(),
  )
}

function handleClose(): void {
  loadGeneration += 1
  query.cancel()
  store.cancelVocabularyRequests()
  packageState.resetPending()
  vocabularyLoading.value = false
  loading.value = false
  open.value = false
  emit('close')
}

/** 打开弹窗：拉取词库成功后初始化选择与搜索，并让虚拟器基于当前内容重新测量。 */
watch(
  open,
  async (isOpen) => {
    const generation = ++loadGeneration
    if (!isOpen) {
      query.cancel()
      store.cancelVocabularyRequests()
      packageState.resetPending()
      vocabularyLoading.value = false
      loading.value = false
      return
    }
    if (vocabularyLoading.value) return
    vocabularyLoading.value = true
    loading.value = true
    try {
      await store.loadVocabulary()
    } finally {
      vocabularyLoading.value = false
      loading.value = false
    }
    // 首次拉取失败时 store.vocabulary 为空：不显示弹窗，由父组件收下 close 供重试。
    if (generation !== loadGeneration || !open.value) return
    const vocab = store.vocabulary
    if (!vocab) {
      handleClose()
      return
    }
    selection.reset(vocab.selectedIds)
    query.clearSearch()
    viewMode.value = 'words'
    await nextTick()
  },
  { immediate: true },
)
</script>

<template>
  <!-- 弹窗基于 BaseDialog 外壳；仅在「已打开且词库已拉取」时渲染内容，避免加载中的空遮罩。 -->
  <BaseDialog
    :open="open && !!store.vocabulary"
    width-class="w-[88cqw]"
    section-class="h-[84cqh]"
    labelledby="vocab-title"
    :close-aria="strings.room.vocabCloseAria"
    @close="handleClose"
  >
    <template #header>
      <SectionHeader
        id="vocab-title"
        :eyebrow="strings.room.vocabLabel"
        :title="
          viewMode === 'packages'
            ? strings.room.vocabSwitchToPackages
            : isReadOnly
              ? strings.room.vocabTitleReadonly
              : strings.room.vocabTitle
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
                    ? strings.room.vocabSearchPlaceholder
                    : strings.room.vocabPackageSearchPlaceholder
                "
                :aria-label="
                  viewMode === 'words'
                    ? strings.room.vocabSearchAria
                    : strings.room.vocabPackageSearchAria
                "
              />
            </div>
            <!-- 圆形切换小按钮：在词条管理与词库包选择之间切换 -->
            <RoundIconButton
              :label="
                viewMode === 'words'
                  ? strings.room.vocabSwitchToPackages
                  : strings.room.vocabSwitchToWords
              "
              :title="
                viewMode === 'words'
                  ? strings.room.vocabSwitchToPackages
                  : strings.room.vocabSwitchToWords
              "
              audio-feedback="select"
              @click="toggleViewMode"
            >
              <Library v-if="viewMode === 'words'" class="h-[2.2cqh] w-[2.2cqh]" />
              <ListFilter v-else class="h-[2.2cqh] w-[2.2cqh]" />
            </RoundIconButton>
          </div>
          <!-- 字段筛选：分类 / 难度（多选，仅词条模式可用）；纯图标 + 悬浮说明 -->
          <div v-if="viewMode === 'words'" class="flex w-1/2 min-w-0 items-center gap-[0.45em]">
            <MultiSelectPopover
              v-for="filter in filterDefs"
              :key="filter.key"
              :label="filter.label"
              :trigger-aria="strings.room.vocabFilterAria(filter.label)"
              :select-all-label="strings.room.vocabSelectAllShort"
              :deselect-all-label="strings.room.vocabDeselectAllShort"
              :options="filter.options"
              :selected="filterSelections[filter.key] ?? []"
              icon-only
              :icon="filter.icon"
              :highlight="true"
              placement="bottom"
              @update:selected="updateFilter(filter.key, $event)"
            />
          </div>
          <!-- 词库包模式右侧信息：显示可用词库数 -->
          <div v-else class="flex w-1/2 min-w-0 items-center justify-end">
            <span class="text-muted text-fs-12">
              {{ strings.room.vocabPackageTotal(store.vocabulary.packages.length) }}
            </span>
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
          :difficulty-max="store.config.ui.difficultyMax"
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
          {{ strings.room.vocabPackageTotal(store.vocabulary?.packages.length ?? 0) }}
        </p>
        <AppButton
          variant="secondary"
          type="button"
          audio-feedback="select"
          @click="viewMode = 'words'"
        >
          {{ strings.room.vocabSwitchToWords }}
        </AppButton>
      </template>
      <!-- 词条管理模式：只读玩家仅提示不可编辑 -->
      <template v-else-if="isReadOnly">
        <p class="mr-auto text-muted text-fs-12" role="status">
          {{ strings.room.vocabReadonlyHint }}
        </p>
      </template>
      <template v-else>
        <!-- 统计：全部 / 搜索结果 / 已选（移到页脚左侧，数字固定 4 位等宽防抖） -->
        <p class="mr-auto min-w-0 text-muted text-fs-12" role="status">
          {{ strings.room.vocabAll }}
          <b class="inline-block min-w-[4ch] text-center tabular-nums text-blue">{{
            store.vocabulary?.items.length ?? 0
          }}</b>
          {{ strings.common.listSeparator }} {{ strings.room.vocabResults }}
          <b class="inline-block min-w-[4ch] text-center tabular-nums text-blue">{{
            filteredWords.length
          }}</b>
          {{ strings.common.listSeparator }} {{ strings.room.vocabSelected }}
          <b class="inline-block min-w-[4ch] text-center tabular-nums text-blue">{{
            selectedIds.size
          }}</b>
          <span
            v-if="selectedIds.size < MIN_SELECTED_VOCABULARY_WORDS"
            class="ml-[1em] font-bold text-red"
            >{{ strings.room.vocabMinHint(MIN_SELECTED_VOCABULARY_WORDS) }}</span
          >
        </p>
        <AppButton variant="secondary" type="button" @click="setSelection(allWordIds, true)">
          {{ strings.room.restoreDefault }}
        </AppButton>
        <AppButton
          variant="primary"
          type="button"
          :disabled="selectedIds.size < MIN_SELECTED_VOCABULARY_WORDS"
          @click="saveVocabulary"
        >
          {{ strings.room.confirmSelection }}
        </AppButton>
      </template>
    </template>
  </BaseDialog>
</template>
