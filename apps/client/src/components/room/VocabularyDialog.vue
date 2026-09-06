<!--
  本局词库管理弹窗 —— 统一列表（表格）视图。
  展示形式固定为表格：多字段陈列 + 表头排序 + 分类/难度筛选，全部字段恒显示（无列显隐）；
  - 房主：可搜索/筛选、复选框批量选择、确认保存（恢复默认全选）；
  - 非房主：可打开查看本局词库，但不可选择（只读：无复选框、无保存，仅能搜索/筛选浏览）。
  两类筛选（分类/难度）与搜索框可叠加生效（取交集）。
  工具栏单行布局：搜索框占左半行，右半行为筛选功能按钮。
  批量选择收敛为一个「统一三态复选框」放于表格表头，作用于当前搜索+筛选结果（无筛选时即全部词条）。
  词库统计（全部/搜索结果/已选）合并到底部操作栏左侧，表格区不单独占行。
  选择集合由父组件持有；全部展示文案来自 config/strings.ts，全部上限/默认值来自 config。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { Library, ListFilter, Star, Tags } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import {
  MIN_SELECTED_VOCABULARY_WORDS,
  normalizeAnswer,
  type VocabularyPackageInfo,
  type VocabularyWord,
} from '@draw-guess/shared'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import SectionHeader from '@/components/common/SectionHeader.vue'
import SearchInput from '@/components/common/SearchInput.vue'
import RoundIconButton from '@/components/common/RoundIconButton.vue'
import MultiSelectPopover, {
  type MultiSelectOption,
} from '@/components/common/MultiSelectPopover.vue'
import type { DataTableColumn } from '@/components/common/DataTable.vue'
import VocabTableView from '@/components/room/VocabTableView.vue'
import VocabPackageTableView from '@/components/room/VocabPackageTableView.vue'
import { useGameStore } from '@/stores/game'
import { useTableSort } from '@/composables/useTableSort'

const open = defineModel<boolean>('open', { default: false })
const loading = defineModel<boolean>('loading', { default: false })
const emit = defineEmits<{ close: [] }>()
const store = useGameStore()

// ---- 词库弹窗内部状态 ----
const viewMode = ref<'words' | 'packages'>('words')
const search = ref('') // 搜索框即时输入
const searchKeyword = ref('') // 防抖后的实际筛选关键词
const selectedIds = ref(new Set<string>()) // 使用响应式 Set，5000+ 词条下单选仍为 O(1)
const vocabularyLoading = ref(false) // 拉取中标记（防重复打开）
let loadGeneration = 0
type ScrollableTable = { scrollToTop(): void; scrollToIndex(index: number): void }
const wordTable = ref<ScrollableTable>()
const packageTable = ref<ScrollableTable>()
/** 只读标志：非房主可打开查看，但不可选择词条（无复选框/无保存）。 */
const isReadOnly = computed(() => !store.isHost)

// ---- 词条表格状态（受控状态，子组件只渲染不持有） ----
const { sortKey, sortDir, handleSort } = useTableSort()
const filterSelections = ref<Record<string, string[]>>({
  category: [],
  difficulty: [],
}) // 字段多选筛选（空数组 = 不筛选）

// ---- 词库包选择状态 ----
const packageSort = useTableSort()
const packageSortKey = packageSort.sortKey
const packageSortDir = packageSort.sortDir
const activePackageId = computed(() => store.vocabulary?.packageId ?? '')
const pendingPackageId = ref<string>()
const displayedPackageId = computed(() => pendingPackageId.value ?? activePackageId.value)

/**
 * 全部词条 ID。统一走可选链而非 `store.vocabulary!` 非空断言：
 * 弹窗只按 `showVocabulary` 挂载，若词库拉取尚未完成或失败，
 * 直接断言会在点击「恢复默认/确认选择」时抛 TypeError。
 */
const allWordIds = computed(() => (store.vocabulary?.items ?? []).map((item) => item.id))

/** 词面与别称的拼接分隔符：用 NUL 字符（用户输入几乎不可能包含），
 *  保证「词面+别称」连成一条后，关键词不会跨越字段边界产生误匹配。
 *  用 String.fromCharCode(0) 生成，源码里保持纯 ASCII，避免出现不可见的控制字节。 */
const SEARCH_SEP = String.fromCharCode(0)

/** 词面+别称的规范化搜索索引：仅在词库快照变化时重建一次，避免每次输入重复处理大数组。 */
const searchableWords = computed(() =>
  (store.vocabulary?.items ?? []).map((word) => ({
    word,
    searchText: [word.text, ...word.aliases].map((text) => normalizeAnswer(text)).join(SEARCH_SEP),
  })),
)

/** 第一层过滤：关键词搜索（匹配词面或任一别称）。 */
const searchedWords = computed<VocabularyWord[]>(() => {
  // 关键词与索引同一规范化口径（NFKC + 折叠空白 + 忽略大小写），与猜词判定的 normalizeAnswer 一致
  const keyword = normalizeAnswer(searchKeyword.value)
  return searchableWords.value
    .filter((entry) => !keyword || entry.searchText.includes(keyword))
    .map((entry) => entry.word)
})

/**
 * 第二层过滤：字段多选筛选与搜索取交集。
 * 每个筛选字段只筛「包含任一选中值」；空选中集合表示该字段不筛选。
 */
const filteredWords = computed<VocabularyWord[]>(() => {
  const selections = filterSelections.value
  return searchedWords.value.filter((word) => {
    const categorySelection = selections.category ?? []
    // 词库单词条仅一个分类：命中任一选中分类即保留
    if (categorySelection.length && !categorySelection.includes(word.category)) return false
    const difficultySelection = selections.difficulty ?? []
    if (difficultySelection.length && !difficultySelection.includes(String(word.difficulty)))
      return false
    return true
  })
})

/** 表格行：在筛选结果上应用排序。 */
const tableRows = computed<VocabularyWord[]>(() => {
  if (!sortKey.value) return filteredWords.value
  const column = allColumns.value.find((candidate) => candidate.key === sortKey.value)
  if (!column) return filteredWords.value
  const value = (word: VocabularyWord): string | number =>
    column.sortValue ? column.sortValue(word) : String(word[column.key as keyof VocabularyWord])
  const sorted = [...filteredWords.value].sort((left, right) => {
    const leftValue = value(left)
    const rightValue = value(right)
    if (typeof leftValue === 'number' && typeof rightValue === 'number')
      return leftValue - rightValue
    return String(leftValue).localeCompare(String(rightValue), 'zh-Hans-CN')
  })
  return sortDir.value === 'desc' ? sorted.reverse() : sorted
})

/** 表头点击：同列翻转方向，异列默认升序。 */
/** 勾选/取消单个词条：选择集合由父组件持有。 */
function toggleWord(id: string): void {
  if (isReadOnly.value) return
  if (selectedIds.value.has(id)) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
}

/** 批量增删选中词条；响应式 Set 避免每次点击复制整个 5000 项数组。 */
function setSelection(ids: string[], selected: boolean): void {
  if (isReadOnly.value) return
  for (const id of ids) {
    if (selected) selectedIds.value.add(id)
    else selectedIds.value.delete(id)
  }
}

/** 统一复选框点击（表头）：未全选 → 全选当前结果；已全选 → 取消当前结果。 */
function toggleSelectAll(): void {
  if (isReadOnly.value) return
  const select = ![...filteredWords.value].every((word) => selectedIds.value.has(word.id))
  setSelection(
    filteredWords.value.map((word) => word.id),
    select,
  )
}

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
  filterSelections.value = { ...filterSelections.value, [key]: values }
  void nextTick(() => wordTable.value?.scrollToTop())
}

// 搜索防抖：用 @vueuse/core 的 useDebounceFn 替代手写 setTimeout + onBeforeUnmount 清理。
// 防抖后回到列表顶部，保证筛选结果与虚拟窗口起点一致。
const debouncedSearch = useDebounceFn((value: string) => {
  searchKeyword.value = value
}, store.config.ui.searchDebounceMs)
watch(search, (value) => debouncedSearch(value))
watch(searchKeyword, () => {
  void nextTick(() =>
    viewMode.value === 'words' ? wordTable.value?.scrollToTop() : packageTable.value?.scrollToTop(),
  )
})

/** 词库包搜索过滤：匹配名称或描述 */
const filteredPackages = computed<VocabularyPackageInfo[]>(() => {
  const packages = store.vocabulary?.packages ?? []
  const keyword = normalizeAnswer(searchKeyword.value)
  if (!keyword) return packages
  return packages.filter((pkg) => {
    const text = normalizeAnswer(`${pkg.name} ${pkg.description}`)
    return text.includes(keyword)
  })
})

/** 词库包排序 */
const tablePackageRows = computed<VocabularyPackageInfo[]>(() => {
  if (!packageSortKey.value) return filteredPackages.value
  const key = packageSortKey.value as keyof VocabularyPackageInfo
  const sorted = [...filteredPackages.value].sort((left, right) => {
    const leftVal = left[key]
    const rightVal = right[key]
    if (typeof leftVal === 'number' && typeof rightVal === 'number') {
      return leftVal - rightVal
    }
    return String(leftVal ?? '').localeCompare(String(rightVal ?? ''), 'zh-Hans-CN')
  })
  return packageSortDir.value === 'desc' ? sorted.reverse() : sorted
})

const handlePackageSort = packageSort.handleSort

/** 切换词库包 */
async function handleSelectPackage(packageId: string): Promise<void> {
  if (isReadOnly.value || pendingPackageId.value || packageId === activePackageId.value) return
  pendingPackageId.value = packageId
  try {
    const ok = await store.selectVocabularyPackage(packageId)
    if (ok && store.vocabulary) {
      selectedIds.value = new Set(store.vocabulary.selectedIds)
      await nextTick()
      packageTable.value?.scrollToTop()
    }
  } finally {
    pendingPackageId.value = undefined
  }
}

/** 切换视图模式：词条列表 <-> 词库包选择 */
function toggleViewMode(): void {
  viewMode.value = viewMode.value === 'words' ? 'packages' : 'words'
  search.value = ''
  searchKeyword.value = ''
  void nextTick(() =>
    viewMode.value === 'words' ? wordTable.value?.scrollToTop() : packageTable.value?.scrollToTop(),
  )
}

function handleClose(): void {
  loadGeneration += 1
  debouncedSearch.cancel()
  store.cancelVocabularyRequests()
  pendingPackageId.value = undefined
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
      debouncedSearch.cancel()
      store.cancelVocabularyRequests()
      pendingPackageId.value = undefined
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
    selectedIds.value = new Set(vocab.selectedIds)
    search.value = ''
    searchKeyword.value = ''
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
        <AppButton variant="secondary" type="button" @click="viewMode = 'words'">
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
