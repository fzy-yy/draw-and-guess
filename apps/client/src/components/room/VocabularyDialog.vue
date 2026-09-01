<!--
  本局词库管理弹窗（房主）——搜索、批量选择、虚拟滚动、确认保存。
  原 RoomView.vue 词库弹窗的脚本逻辑与模板整体迁入本组件，基于 BaseDialog 复用弹窗外壳。
  词库在打开时由本组件调用 store.loadVocabulary 拉取；失败不显示、发 close 供父组件重试。
  虚拟网格改用 @tanstack/vue-virtual 的 useVirtualizer：以「词条行」为虚拟项（每行 6 列），
  依赖其内置的滚动/尺寸观察与 measureElement 逐行实测行高，替代原来手写的
  spacer+window+行高测量（wordGridScrollTop/wordRowStride/updateVirtualMetrics 等）。
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { Check, Search, X } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { VocabularyItem } from '@draw-guess/shared'
import BaseDialog from '@/components/BaseDialog.vue'
import AppButton from '@/components/AppButton.vue'
import { useGameStore } from '@/stores/game'

const props = defineProps<{ open: boolean; loading?: boolean }>()
const emit = defineEmits<{ close: []; 'update:loading': [value: boolean] }>()
const store = useGameStore()

// ---- 词库弹窗内部状态 ----
const search = ref('') // 搜索框即时输入
const searchKeyword = ref('') // 150ms 防抖后的实际筛选关键词
const selectedIds = ref(new Set<string>()) // 使用响应式 Set，5000+ 词条下单选仍为 O(1)
const vocabularyLoading = ref(false) // 拉取中标记（防重复打开）
const wordGrid = ref<HTMLElement>() // 虚拟滚动可视容器（也是滚动元素）
let searchTimer: number | undefined
const WORD_GRID_COLUMNS = 6

/**
 * 全部词条 ID。统一走可选链而非 `store.vocabulary!` 非空断言：
 * 弹窗现在只按 `showVocabulary` 挂载，若词库拉取尚未完成或失败，
 * 直接断言会在点击「全选/取消全选/恢复默认」时抛 TypeError。
 */
const allWordIds = computed(() => (store.vocabulary?.items ?? []).map((item) => item.id))

// 词面规范化结果仅在词库快照变化时生成一次，避免每次输入重复处理 5000 个字符串。
const searchableWords = computed(() =>
  (store.vocabulary?.items ?? []).map((item) => ({
    item,
    searchText: item.text.normalize('NFKC').toLocaleLowerCase(),
  })),
)
const filteredWords = computed<VocabularyItem[]>(() => {
  const keyword = searchKeyword.value.normalize('NFKC').trim().toLocaleLowerCase()
  return searchableWords.value
    .filter((entry) => !keyword || entry.searchText.includes(keyword))
    .map((entry) => entry.item)
})

// 虚拟网格：以「每行 6 个词条」为虚拟项（count = 行数），行高由 measureElement 逐行实测
// （含行间距，见模板中的 pb），滚动与可视范围由 useVirtualizer 基于容器尺寸/偏移观察得出，
// 无需手写窗口计算。count 依赖 filteredWords（搜索/词库更新会驱动虚拟器重新计算）。
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: Math.ceil(filteredWords.value.length / WORD_GRID_COLUMNS),
    getScrollElement: () => wordGrid.value ?? null, // 容器尚未挂载时为 null，挂载后由内部观察自动接管
    estimateSize: () => 50, // 初始估算行高（px）；随后由 measureElement 实测校准，避免 cqh 缩放漂移
    overscan: 3,
  })),
)

/** 透传给 measureElement 的模板 ref 处理：Vue 传入的元素可能是组件实例，需先判空并窄化为 HTMLElement。 */
function measureElementRef(el: unknown): void {
  if (el instanceof HTMLElement) rowVirtualizer.value.measureElement(el)
}

/** 取虚拟行 index 对应的 6 列词条切片（末行可能不足 6 个）。 */
function rowItems(rowIndex: number): VocabularyItem[] {
  const start = rowIndex * WORD_GRID_COLUMNS
  return filteredWords.value.slice(start, start + WORD_GRID_COLUMNS)
}

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
    // 每次打开都可能换词库/换列表内容，触发一次全量重新测量以校正行高与总高。
    rowVirtualizer.value.measure()
  },
  { immediate: true },
)

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

// 搜索防抖后回到列表顶部，保证筛选结果与虚拟窗口起点一致。
watch(search, (value) => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    searchKeyword.value = value
    if (wordGrid.value) wordGrid.value.scrollTop = 0
  }, 150)
})

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
})
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
      <!-- 词库统计：全部 / 搜索结果 / 已选数量 -->
      <div class="flex gap-[2em] py-[1.2cqh] px-[1.7em] text-slate-600 bg-sky-100 text-[0.78em]">
        <span
          >{{ strings.room.vocabAll }}
          <b class="text-blue">{{ store.vocabulary?.items.length ?? 0 }}</b></span
        ><span
          >{{ strings.room.vocabResults }} <b class="text-blue">{{ filteredWords.length }}</b></span
        ><span
          >{{ strings.room.vocabSelected }} <b class="text-blue">{{ selectedIds.size }}</b></span
        >
      </div>
      <!-- 工具栏：搜索框 + 四个批量选择按钮 -->
      <div
        class="grid grid-cols-[2fr_repeat(4,auto)] gap-[0.6em] py-[1.1cqh] px-[1.7em] border-b-[0.18cqh] border-b-line"
      >
        <label
          class="flex h-[4.8cqh] items-center gap-[0.6em] rounded-[0.65em] border-[0.18cqh] border-line bg-white px-[0.75em]"
          ><Search /><input
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
      <!-- 虚拟词条网格：外层容器保留完整滚动高度，内部按行挂载可视行 + 缓冲行。 -->
      <div
        ref="wordGrid"
        class="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-[1.7em] [overscroll-behavior:contain] [scrollbar-gutter:stable]"
      >
        <div class="relative w-full" :style="{ height: `${rowVirtualizer.getTotalSize()}px` }">
          <div
            v-for="virtualRow in rowVirtualizer.getVirtualItems()"
            :key="String(virtualRow.key)"
            :ref="measureElementRef"
            :data-index="virtualRow.index"
            class="word-grid-window absolute top-0 grid w-full grid-cols-6 [grid-auto-rows:5.6cqh] gap-[0.8cqh_0.6em] pb-[0.8cqh] will-change-transform"
            :style="{ transform: `translateY(${virtualRow.start}px)` }"
          >
            <label
              v-for="item in rowItems(virtualRow.index)"
              :key="item.id"
              class="flex min-w-0 items-center gap-[0.4em] rounded-[0.5em] border-[0.16cqh] border-line bg-white px-[0.65em] py-[0.5cqh] text-[0.76em] text-slate-600 cursor-pointer"
              :class="selectedIds.has(item.id) ? '!border-blue !bg-sky-100 !text-[#1e3a8a]' : ''"
              ><input
                type="checkbox"
                class="absolute [opacity:0]"
                :checked="selectedIds.has(item.id)"
                @change="setSelection([item.id], !selectedIds.has(item.id))" /><span
                class="flex-1 truncate"
                >{{ item.text }}</span
              ><Check v-if="selectedIds.has(item.id)" class="text-blue"
            /></label>
          </div>
        </div>
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
