<!--
  词库管理·散列视图（从 VocabularyDialog 拆出的子组件）。
  展示形式：每个词条一格，只突出「词面」字段，配合虚拟滚动承载大词库。
  - 虚拟滚动统一走 useVirtualRows 组合式逻辑（与表格视图共享同一份虚拟化实现）；
  - 选择交互（隐形复选框 + 整行点击）保持不变，选择集合由父组件持有。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { VocabularyWord } from '@draw-guess/shared'
import { useVirtualRows } from '@/composables/useVirtualRows'

const props = defineProps<{
  /** 待展示词条（父组件已完成搜索与筛选） */
  words: VocabularyWord[]
  /** 已选词条 ID 集合（受控：父组件持有） */
  selectedIds: Set<string>
}>()

const emit = defineEmits<{
  /** 勾选/取消某个词条：上抛词条 ID，由父组件统一维护选择集合 */
  toggle: [id: string]
}>()

// —— 虚拟滚动：以「每行 6 个词条」为虚拟项，行高由 measureElement 逐行实测 ——
const wordGrid = ref<HTMLElement>()
const WORD_GRID_COLUMNS = 6

const {
  virtualizer: rowVirtualizer,
  measureElementRef,
  sliceFor,
} = useVirtualRows({
  scrollElement: wordGrid,
  count: computed(() => props.words.length),
  estimateSize: 50, // 初始估算行高（px）；随后由 measureElement 实测校准，避免 cqh 缩放漂移
  itemsPerVirtual: WORD_GRID_COLUMNS,
})

/** 取某个虚拟行对应的 6 列词条切片（末行可能不足 6 个）。 */
function rowItems(rowIndex: number): VocabularyWord[] {
  const { start, end } = sliceFor(rowIndex)
  return props.words.slice(start, end)
}
</script>

<template>
  <!-- 虚拟词条网格：外层容器保留完整滚动高度，内部按行挂载可视行 + 缓冲行 -->
  <div
    ref="wordGrid"
    class="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[1.7em] overscroll-contain scrollbar-gutter-stable"
  >
    <div class="relative w-full" :style="{ height: `${rowVirtualizer.getTotalSize()}px` }">
      <div
        v-for="virtualRow in rowVirtualizer.getVirtualItems()"
        :key="String(virtualRow.key)"
        :ref="measureElementRef"
        :data-index="virtualRow.index"
        class="word-grid-window absolute top-0 grid w-full grid-cols-6 auto-rows-[5.6cqh] gap-[0.8cqh_0.6em] pb-[0.8cqh] will-change-transform"
        :style="{ transform: `translateY(${virtualRow.start}px)` }"
      >
        <label
          v-for="item in rowItems(virtualRow.index)"
          :key="item.id"
          class="flex min-w-0 items-center gap-[0.4em] rounded-[0.5em] border-[0.16cqh] border-line bg-white px-[0.65em] py-[0.5cqh] text-[0.76em] text-muted cursor-pointer"
          :class="selectedIds.has(item.id) ? 'border-blue! bg-sky! text-blue!' : ''"
          ><input
            type="checkbox"
            class="absolute opacity-[0]"
            :checked="selectedIds.has(item.id)"
            @change="emit('toggle', item.id)" /><span class="flex-1 truncate">{{ item.text }}</span
          ><Check v-if="selectedIds.has(item.id)" class="text-blue" aria-hidden="true"
        /></label>
      </div>
      <!-- 空态：搜索/筛选无结果 -->
      <p
        v-if="!props.words.length"
        class="grid place-items-center py-[4cqh] text-[0.74em] text-muted"
        role="status"
      >
        {{ strings.room.vocabNoMatch }}
      </p>
    </div>
  </div>
</template>
