import { computed, ref, watch, type Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import {
  normalizeAnswer,
  type VocabularyPackageInfo,
  type VocabularyWord,
} from '@draw-guess/shared'
import type { DataTableColumn } from '@/components/common/data-table.types'
import { applySortDir, compareValues, useTableSort } from './useTableSort'

/**
 * 多词面（text + aliases）拼接的分隔符（NUL）：选它而非普通字符，是因为 `\u0000`
 * 不可能出现在用户输入或词面中——用普通字符做分隔时，跨拼接边界的关键词（如词条
 * 正文的尾段 + 别名的首段连成一个词）会意外命中；NUL 保证匹配只发生在单个真实
 * 词面内部。
 */
const SEARCH_SEPARATOR = String.fromCharCode(0)

/** 词库词条/包的搜索、筛选和排序状态。 */
export function useVocabularyQuery(options: {
  words: Ref<VocabularyWord[]>
  packages: Ref<VocabularyPackageInfo[]>
  columns: Ref<DataTableColumn<VocabularyWord>[]>
  debounceMs: number
}) {
  const search = ref('')
  const searchKeyword = ref('')
  // 分类筛选与搜索叠加生效（取交集）；难度/可绘制性筛选已随词库瘦身移除
  const filterSelections = ref<Record<string, string[]>>({ category: [] })
  const wordSort = useTableSort()

  const searchableWords = computed(() =>
    options.words.value.map((word) => ({
      word,
      searchText: [word.text, ...word.aliases]
        .map((text) => normalizeAnswer(text))
        .join(SEARCH_SEPARATOR),
    })),
  )
  const searchedWords = computed(() => {
    const keyword = normalizeAnswer(searchKeyword.value)
    return searchableWords.value
      .filter((entry) => !keyword || entry.searchText.includes(keyword))
      .map((entry) => entry.word)
  })
  const filteredWords = computed(() =>
    searchedWords.value.filter((word) => {
      const categories = filterSelections.value.category ?? []
      return !categories.length || categories.includes(word.category)
    }),
  )
  const wordRows = computed(() => {
    if (!wordSort.sortKey.value) return filteredWords.value
    const column = options.columns.value.find(
      (candidate) => candidate.key === wordSort.sortKey.value,
    )
    if (!column) return filteredWords.value
    const value = (word: VocabularyWord): string | number =>
      column.sortValue ? column.sortValue(word) : String(word[column.key])
    // 比较与方向应用与词库包表共用 useTableSort 导出的同构实现（单口径）。
    const sorted = [...filteredWords.value].sort((left, right) =>
      compareValues(value(left), value(right)),
    )
    return applySortDir(sorted, wordSort.sortDir.value === 'desc')
  })
  const filteredPackages = computed(() => {
    const keyword = normalizeAnswer(searchKeyword.value)
    if (!keyword) return options.packages.value
    return options.packages.value.filter((item) =>
      normalizeAnswer(`${item.name} ${item.description}`).includes(keyword),
    )
  })

  const debouncedSearch = useDebounceFn(
    (value: string) => (searchKeyword.value = value),
    options.debounceMs,
  )
  watch(search, (value) => debouncedSearch(value))

  function updateFilter(key: string, values: string[]): void {
    filterSelections.value = { ...filterSelections.value, [key]: values }
  }

  function clearSearch(): void {
    debouncedSearch.cancel()
    search.value = ''
    searchKeyword.value = ''
  }

  return {
    search,
    searchKeyword,
    filterSelections,
    filteredWords,
    wordRows,
    filteredPackages,
    sortKey: wordSort.sortKey,
    sortDir: wordSort.sortDir,
    handleSort: wordSort.handleSort,
    updateFilter,
    clearSearch,
    cancel: () => debouncedSearch.cancel(),
  }
}
