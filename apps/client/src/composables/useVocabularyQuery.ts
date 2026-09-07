import { computed, ref, watch, type Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import {
  normalizeAnswer,
  type VocabularyPackageInfo,
  type VocabularyWord,
} from '@draw-guess/shared'
import type { DataTableColumn } from '@/components/common/DataTable.vue'
import { useTableSort } from './useTableSort'

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
  const filterSelections = ref<Record<string, string[]>>({ category: [], difficulty: [] })
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
      const difficulties = filterSelections.value.difficulty ?? []
      return (
        (!categories.length || categories.includes(word.category)) &&
        (!difficulties.length || difficulties.includes(String(word.difficulty)))
      )
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
    const sorted = [...filteredWords.value].sort((left, right) => {
      const leftValue = value(left)
      const rightValue = value(right)
      if (typeof leftValue === 'number' && typeof rightValue === 'number')
        return leftValue - rightValue
      return String(leftValue).localeCompare(String(rightValue), 'zh-Hans-CN')
    })
    return wordSort.sortDir.value === 'desc' ? sorted.reverse() : sorted
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

  function reset(): void {
    debouncedSearch.cancel()
    search.value = ''
    searchKeyword.value = ''
    filterSelections.value = { category: [], difficulty: [] }
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
    reset,
    clearSearch,
    cancel: () => debouncedSearch.cancel(),
  }
}
