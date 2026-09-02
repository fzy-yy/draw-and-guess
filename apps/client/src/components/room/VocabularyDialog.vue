<!--
  本局词库管理弹窗（房主）——搜索、多字段筛选、排序、双视图陈列、批量选择、确认保存。
  展示形式两档可切换（config/ui.vocabDefaultView 决定默认档）：
  - 散列视图（VocabGridView）：仅词面 + 虚拟滚动，适合快速勾选；
  - 表格视图（VocabTableView）：多字段陈列 + 表头排序 + 列显隐，适合逐条审阅词库质量。
  三类筛选（分类/难度/语言）与搜索框可叠加生效（取交集）；表格列显隐由「显示字段」弹层控制。
  选择集合为两视图共享；全部展示文案来自 config/strings.ts，全部上限/默认值来自 config。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { LayoutGrid, Search, Table2, X } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { VocabularyWord } from '@draw-guess/shared'
import BaseDialog from '@/components/BaseDialog.vue'
import AppButton from '@/components/AppButton.vue'
import MultiSelectPopover, {
  type MultiSelectOption,
} from '@/components/common/MultiSelectPopover.vue'
import type { DataTableColumn } from '@/components/common/DataTable.vue'
import VocabGridView from '@/components/room/VocabGridView.vue'
import VocabTableView from '@/components/room/VocabTableView.vue'
import { useGameStore } from '@/stores/game'

const props = defineProps<{ open: boolean; loading?: boolean }>()
const emit = defineEmits<{ close: []; 'update:loading': [value: boolean] }>()
const store = useGameStore()

// ---- 词库弹窗内部状态 ----
const search = ref('') // 搜索框即时输入
const searchKeyword = ref('') // 防抖后的实际筛选关键词
const selectedIds = ref(new Set<string>()) // 使用响应式 Set，5000+ 词条下单选仍为 O(1)
const vocabularyLoading = ref(false) // 拉取中标记（防重复打开）

// ---- 展示形式与表格状态（均为受控状态，子组件只渲染不持有） ----
type VocabViewMode = (typeof store.config.ui)['vocabDefaultView']
const viewMode = ref<VocabViewMode>(store.config.ui.vocabDefaultView)
const sortKey = ref<string | null>(null) // 当前排序字段（null = 数据原序）
const sortDir = ref<'asc' | 'desc'>('asc')
const visibleColumnKeys = ref<string[]>([
  'text',
  'categories',
  'difficulty',
  'aliases',
  'lang',
  'timeLimit',
]) // 默认隐藏 tags/scoreWeight，避免表格过宽，可通过「显示字段」开启
const filterSelections = ref<Record<string, string[]>>({
  categories: [],
  difficulty: [],
  lang: [],
}) // 字段多选筛选（空数组 = 不筛选）

/**
 * 全部词条 ID。统一走可选链而非 `store.vocabulary!` 非空断言：
 * 弹窗只按 `showVocabulary` 挂载，若词库拉取尚未完成或失败，
 * 直接断言会在点击「全选/取消全选/恢复默认」时抛 TypeError。
 */
const allWordIds = computed(() => (store.vocabulary?.items ?? []).map((item) => item.id))

/** 词面+别称的规范化搜索索引：仅在词库快照变化时重建一次，避免每次输入重复处理大数组。 */
const searchableWords = computed(() =>
  (store.vocabulary?.items ?? []).map((word) => ({
    word,
    searchText: [word.text, ...word.aliases]
      .map((text) => text.normalize('NFKC').toLocaleLowerCase())
      .join('\u0000'),
  })),
)

/** 第一层过滤：关键词搜索（匹配词面或任一别称）。 */
const searchedWords = computed<VocabularyWord[]>(() => {
  const keyword = searchKeyword.value.normalize('NFKC').trim().toLocaleLowerCase()
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
    const categorySelection = selections.categories ?? []
    if (
      categorySelection.length &&
      !word.categories.some((category) => categorySelection.includes(category))
    )
      return false
    const difficultySelection = selections.difficulty ?? []
    if (difficultySelection.length && !difficultySelection.includes(String(word.difficulty)))
      return false
    const langSelection = selections.lang ?? []
    if (langSelection.length && !langSelection.includes(word.lang)) return false
    return true
  })
})

/** 表格行：在筛选结果上应用排序（散列视图保持词库原序，不参与排序）。 */
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
function handleSort(key: string): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

/** 勾选/取消单个词条：选择集合为两视图共享。 */
function toggleWord(id: string): void {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
}

/** 批量增删选中词条；响应式 Set 避免每次点击复制整个 5000 项数组。 */
function setSelection(ids: string[], selected: boolean): void {
  for (const id of ids) {
    if (selected) selectedIds.value.add(id)
    else selectedIds.value.delete(id)
  }
}

/** 保存词库选择；请求失败由统一请求层提示，并保留当前弹窗和选择供重试。 */
async function saveVocabulary(): Promise<void> {
  await store.saveVocabulary([...selectedIds.value])
  emit('close')
}

/** 表格列定义（label 全部来自 strings，禁止硬编码）。 */
const allColumns = computed<DataTableColumn<VocabularyWord>[]>(() => [
  { key: 'text', label: strings.room.vocabColumnText },
  {
    key: 'categories',
    label: strings.room.vocabColumnCategories,
    sortValue: (word) => word.categories.join(','),
  },
  { key: 'difficulty', label: strings.room.vocabColumnDifficulty },
  {
    key: 'aliases',
    label: strings.room.vocabColumnAliases,
    sortValue: (word) => word.aliases.join(','),
  },
  {
    key: 'tags',
    label: strings.room.vocabColumnTags,
    sortValue: (word) => word.tags.join(','),
  },
  { key: 'lang', label: strings.room.vocabColumnLang },
  {
    key: 'timeLimit',
    label: strings.room.vocabColumnTimeLimit,
    sortValue: (word) => word.timeLimit ?? 0,
  },
  {
    key: 'scoreWeight',
    label: strings.room.vocabColumnScoreWeight,
    sortValue: (word) => word.scoreWeight ?? 0,
  },
])
/** 传给表格的可见列（「显示字段」弹层控制，词面列恒可见，避免出现无主内容的表格）。 */
const visibleColumns = computed<DataTableColumn<VocabularyWord>[]>(() =>
  allColumns.value.filter(
    (column) => column.key === 'text' || visibleColumnKeys.value.includes(column.key),
  ),
)
/** 「显示字段」弹层选项：全部列均可开关（含词面列，勾掉后表格仍保底显示词面）。 */
const columnOptions = computed<MultiSelectOption[]>(() =>
  allColumns.value.map((column) => ({ value: column.key, label: column.label })),
)

/** 字段筛选定义：分类（来自词库白名单）/ 难度（1~上限）/ 语言（词库内实际出现的语言）。 */
const filterDefs = computed<Array<{ key: string; label: string; options: MultiSelectOption[] }>>(
  () => {
    const difficultyMax = store.config.ui.difficultyMax
    const langs = [...new Set((store.vocabulary?.items ?? []).map((word) => word.lang))]
    return [
      {
        key: 'categories',
        label: strings.room.vocabColumnCategories,
        options: (store.vocabulary?.categories ?? []).map((category) => ({
          value: category,
          label: category,
        })),
      },
      {
        key: 'difficulty',
        label: strings.room.vocabColumnDifficulty,
        options: Array.from({ length: difficultyMax }, (_item, index) => {
          const value = index + 1
          return { value: String(value), label: strings.room.vocabDifficultyLabel(value) }
        }),
      },
      {
        key: 'lang',
        label: strings.room.vocabColumnLang,
        options: langs.map((lang) => ({ value: lang, label: lang })),
      },
    ]
  },
)

/** 更新某个筛选字段的选中集合（MultiSelectPopover 受控回写）。 */
function updateFilter(key: string, values: string[]): void {
  filterSelections.value = { ...filterSelections.value, [key]: values }
}

// 搜索防抖：用 @vueuse/core 的 useDebounceFn 替代手写 setTimeout + onBeforeUnmount 清理。
// 防抖后回到列表顶部，保证筛选结果与虚拟窗口起点一致。
const debouncedSearch = useDebounceFn((value: string) => {
  searchKeyword.value = value
}, 150)
watch(search, (value) => debouncedSearch(value))

/** 打开弹窗：拉取词库成功后初始化选择与搜索，并让虚拟器基于当前内容重新测量。 */
watch(
  () => props.open,
  async (open) => {
    if (!open || vocabularyLoading.value) return
    vocabularyLoading.value = true
    emit('update:loading', true)
    try {
      await store.loadVocabulary()
    } finally {
      vocabularyLoading.value = false
      emit('update:loading', false)
    }
    // 首次拉取失败时 store.vocabulary 为空：不显示弹窗，由父组件收下 close 供重试。
    const vocab = store.vocabulary
    if (!vocab) {
      emit('close')
      return
    }
    selectedIds.value = new Set(vocab.selectedIds)
    search.value = ''
    searchKeyword.value = ''
    await nextTick()
  },
  { immediate: true },
)
</script>

<template>
  <!-- 弹窗基于 BaseDialog 外壳；仅在「已打开且词库已拉取」时渲染内容，避免加载中的空遮罩。 -->
  <BaseDialog
    :open="props.open && !!store.vocabulary"
    width-class="w-[88cqw]"
    section-class="h-[84cqh]"
    labelledby="vocab-title"
    :close-aria="strings.room.vocabCloseAria"
    @close="emit('close')"
  >
    <template #header>
      <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
        {{ strings.room.vocabLabel }}
      </p>
      <h2 id="vocab-title">{{ strings.room.vocabTitle }}</h2>
    </template>

    <template v-if="store.vocabulary">
      <div class="flex min-h-0 flex-1 flex-col">
        <!-- 工具栏：搜索 + 视图切换 + 显示字段 + 字段筛选（全部可与搜索叠加） -->
        <div
          class="flex flex-wrap items-center gap-[0.6em] py-[1.1cqh] px-[1.7em] border-b-[0.18cqh] border-b-line"
        >
          <label
            class="flex h-[4.8cqh] min-w-[16cqw] flex-[2] items-center gap-[0.6em] rounded-[0.65em] border-[0.18cqh] border-line bg-white px-[0.75em]"
            ><Search aria-hidden="true" /><input
              v-model="search"
              class="w-full min-w-0 border-0 outline-0 bg-transparent"
              :placeholder="strings.room.vocabSearchPlaceholder"
              :aria-label="strings.room.vocabSearchAria" /><button
              v-if="search"
              type="button"
              :aria-label="strings.room.vocabClearSearchAria"
              class="grid place-items-center bg-transparent"
              @click="search = ''"
            >
              <X /></button
          ></label>
          <!-- 视图切换：散列（仅词面）/ 表格（多字段） -->
          <div
            class="flex h-[4.8cqh] items-center gap-[0.3em] rounded-[0.65em] border-[0.18cqh] border-line bg-white p-[0.3em]"
            role="group"
            :aria-label="strings.room.vocabViewSwitchAria"
          >
            <button
              v-for="mode in ['grid', 'table'] as const"
              :key="mode"
              type="button"
              class="flex h-full items-center gap-[0.3em] rounded-[0.45em] px-[0.7em] text-[0.68em] font-extrabold"
              :class="
                viewMode === mode ? 'bg-blue text-white' : 'text-slate-600 hover:bg-slate-100'
              "
              :aria-pressed="viewMode === mode"
              @click="viewMode = mode"
            >
              <LayoutGrid v-if="mode === 'grid'" class="h-[1.5cqh] w-[1.5cqh]" aria-hidden="true" />
              <Table2 v-else class="h-[1.5cqh] w-[1.5cqh]" aria-hidden="true" />
              {{ mode === 'grid' ? strings.room.vocabViewGrid : strings.room.vocabViewTable }}
            </button>
          </div>
          <!-- 显示字段：控制表格可见列（列显隐） -->
          <MultiSelectPopover
            :label="strings.room.vocabShowColumns"
            :options="columnOptions"
            :selected="visibleColumnKeys"
            @update:selected="visibleColumnKeys = $event"
          />
          <!-- 字段筛选：分类 / 难度 / 语言（多选，可叠加搜索） -->
          <MultiSelectPopover
            v-for="filter in filterDefs"
            :key="filter.key"
            :label="
              (filterSelections[filter.key] ?? []).length
                ? `${filter.label} · ${(filterSelections[filter.key] ?? []).length}`
                : strings.room.vocabFilterAll(filter.label)
            "
            :options="filter.options"
            :selected="filterSelections[filter.key] ?? []"
            @update:selected="updateFilter(filter.key, $event)"
          />
        </div>

        <!-- 词库统计：全部 / 搜索+筛选结果 / 已选数量 -->
        <div class="flex gap-[2em] py-[1cqh] px-[1.7em] text-slate-600 bg-sky-100 text-[0.78em]">
          <span
            >{{ strings.room.vocabAll }}
            <b class="text-blue">{{ store.vocabulary?.items.length ?? 0 }}</b></span
          ><span
            >{{ strings.room.vocabResults }}
            <b class="text-blue">{{ filteredWords.length }}</b></span
          ><span
            >{{ strings.room.vocabSelected }} <b class="text-blue">{{ selectedIds.size }}</b></span
          >
        </div>

        <!-- 批量选择工具条：全选/取消全选作用于全部词条，全选/取消结果作用于当前筛选结果 -->
        <div
          class="flex flex-wrap gap-[0.6em] px-[1.7em] py-[0.9cqh] border-b-[0.18cqh] border-b-line"
        >
          <button
            type="button"
            class="px-[0.8em] text-navy bg-slate-200 rounded-[0.5em] text-[0.72em] font-extrabold"
            @click="setSelection(allWordIds, true)"
          >
            {{ strings.room.selectAll }}
          </button>
          <button
            type="button"
            class="px-[0.8em] text-navy bg-slate-200 rounded-[0.5em] text-[0.72em] font-extrabold"
            @click="setSelection(allWordIds, false)"
          >
            {{ strings.room.deselectAll }}
          </button>
          <button
            type="button"
            class="px-[0.8em] text-navy bg-slate-200 rounded-[0.5em] text-[0.72em] font-extrabold"
            @click="
              setSelection(
                filteredWords.map((item) => item.id),
                true,
              )
            "
          >
            {{ strings.room.selectResults }}
          </button>
          <button
            type="button"
            class="px-[0.8em] text-navy bg-slate-200 rounded-[0.5em] text-[0.72em] font-extrabold"
            @click="
              setSelection(
                filteredWords.map((item) => item.id),
                false,
              )
            "
          >
            {{ strings.room.deselectResults }}
          </button>
        </div>

        <!-- 内容区：双视图切换。keep-alive 保留两视图各自的滚动位置与虚拟器测量结果 -->
        <KeepAlive>
          <VocabGridView
            v-if="viewMode === 'grid'"
            :words="filteredWords"
            :selected-ids="selectedIds"
            @toggle="toggleWord"
          />
          <VocabTableView
            v-else
            :rows="tableRows"
            :columns="visibleColumns"
            :selected-ids="selectedIds"
            :sort-key="sortKey"
            :sort-dir="sortDir"
            @sort="handleSort"
            @toggle="toggleWord"
          />
        </KeepAlive>
      </div>
    </template>

    <template #footer>
      <!-- 底部操作：保存词库（数量不足时禁用）或恢复默认全选 -->
      <p
        class="mr-auto text-muted text-[0.72em]"
        :class="selectedIds.size < store.config.vocabulary.minWords ? '!text-red' : ''"
      >
        {{ strings.room.vocabMinHint(store.config.vocabulary.minWords) }}
      </p>
      <AppButton variant="secondary" type="button" @click="setSelection(allWordIds, true)">
        {{ strings.room.restoreDefault }}
      </AppButton>
      <AppButton
        variant="primary"
        type="button"
        :disabled="selectedIds.size < store.config.vocabulary.minWords"
        @click="saveVocabulary"
      >
        {{ strings.room.confirmSelection }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
